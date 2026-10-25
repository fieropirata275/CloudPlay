package it.neurofix.cloudplay

import android.app.AlertDialog
import android.graphics.Color
import android.media.AudioAttributes
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RendererCommon
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack
import org.webrtc.audio.JavaAudioDeviceModule
import java.nio.ByteBuffer
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

class StreamActivity : AppCompatActivity() {
    companion object {
        private const val MAX_PADS = 4
        private const val KEEPALIVE_MS = 100L
        private const val ABR_MIN = 2000
        private const val ABR_MAX = 20000
        private var factoryInit = false
    }

    private lateinit var prefs: Prefs
    private lateinit var api: Api
    private lateinit var sessionId: String

    private lateinit var renderer: SurfaceViewRenderer
    private lateinit var status: TextView
    private lateinit var spinner: ProgressBar
    private lateinit var stats: TextView
    private var touch: TouchControlsView? = null

    private val egl: EglBase = EglBase.create()
    private lateinit var factory: PeerConnectionFactory
    private var pc: PeerConnection? = null
    private var ws: WebSocket? = null
    private var inputCh: DataChannel? = null
    private var controlCh: DataChannel? = null
    private var iceServers = listOf<PeerConnection.IceServer>()
    private var signalUrl = ""
    private var offerMids = listOf<String>()
    private var closed = false
    private var reconnectAttempt = 0

    private val main = Handler(Looper.getMainLooper())

    // ------------------------------------------------------------ input state
    private val keyButtons = IntArray(MAX_PADS)
    private val hatButtons = IntArray(MAX_PADS)
    private val axes = Array(MAX_PADS) { PadState() }
    private val last = Array(MAX_PADS) { PadState() }
    private val seq = IntArray(MAX_PADS)
    private val deviceSlot = HashMap<Int, Int>()
    private var touchButtons = 0; private var touchLx = 0f; private var touchLy = 0f
    private var comboSince = 0L
    private var menuOpen = false

    // ---------------------------------------------------------------- ABR
    private var bitrate = 8000
    private var manualBitrate = 0
    private var prevLost = -1L; private var prevRecv = 0L; private var prevBytes = 0L; private var prevFrames = 0L; private var prevTs = 0.0
    private var showStats = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        api = Api(prefs)
        sessionId = intent.getStringExtra("session_id") ?: return finish()
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        immersive()
        buildUi()
        initWebRtc()
        lifecycleScope.launch {
            try {
                val s = api.obj("GET", "/api/sessions/$sessionId")
                if (!s.has("signal_url")) return@launch end(s.optString("error").ifEmpty { "La sesión ya ha terminado" })
                signalUrl = s.getString("signal_url")
                if (s.optString("status") == "queued") showQueue(s.optInt("queue_position", 1))
                iceServers = parseIce(s.optJSONArray("ice_servers") ?: JSONArray())
                connectSignal()
            } catch (e: Exception) { end(e.message ?: "Error") }
        }
        main.post(keepalive)
        main.postDelayed(statsLoop, 2000)
    }

    private fun immersive() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private fun buildUi() {
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        renderer = SurfaceViewRenderer(this)
        root.addView(renderer, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER))
        spinner = ProgressBar(this)
        root.addView(spinner, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        status = TextView(this).apply { setTextColor(Color.WHITE); textSize = 16f; gravity = Gravity.CENTER; setPadding(0, 220, 0, 0) }
        root.addView(status, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        stats = TextView(this).apply {
            setTextColor(Color.parseColor("#7CF29A")); textSize = 11f; typeface = android.graphics.Typeface.MONOSPACE
            setBackgroundColor(Color.argb(150, 0, 0, 0)); setPadding(12, 6, 12, 6); visibility = View.GONE
        }
        root.addView(stats, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.START))

        // Controles táctiles solo si hay pantalla táctil y ningún mando conectado
        if (packageManager.hasSystemFeature("android.hardware.touchscreen") && !hasGamepad()) {
            touch = TouchControlsView(this) { b, x, y -> touchButtons = b; touchLx = x; touchLy = y; flush(false) }
            root.addView(touch, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            val menuBtn = TextView(this).apply {
                text = "☰"; textSize = 22f; setTextColor(Color.argb(160, 255, 255, 255)); setPadding(30, 20, 30, 20)
                setOnClickListener { openMenu() }
            }
            root.addView(menuBtn, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.CENTER_HORIZONTAL))
        }
        setContentView(root)
        setStatus("Arrancando la consola en la nube…")
    }

    private fun hasGamepad() = InputDevice.getDeviceIds().any { id ->
        val src = InputDevice.getDevice(id)?.sources ?: 0
        (src and InputDevice.SOURCE_GAMEPAD == InputDevice.SOURCE_GAMEPAD) || (src and InputDevice.SOURCE_JOYSTICK == InputDevice.SOURCE_JOYSTICK)
    }

    private fun showQueue(position: Int) {
        setStatus(if (position <= 1) "Eres el siguiente en la cola" else "Estás el $position.º en la cola")
    }

    private fun setStatus(text: String) {
        status.text = text
        val visible = text.isNotEmpty()
        status.visibility = if (visible) View.VISIBLE else View.GONE
        spinner.visibility = if (visible) View.VISIBLE else View.GONE
    }

    // ---------------------------------------------------------------- WebRTC
    private fun initWebRtc() {
        if (!factoryInit) {
            PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(applicationContext).createInitializationOptions())
            factoryInit = true
        }
        val adm = JavaAudioDeviceModule.builder(this)
            .setUseStereoOutput(true)
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()
            )
            .createAudioDeviceModule()
        factory = PeerConnectionFactory.builder()
            .setAudioDeviceModule(adm)
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext))
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(egl.eglBaseContext, true, true))
            .createPeerConnectionFactory()
        adm.release() // la factory mantiene su propia referencia
        renderer.init(egl.eglBaseContext, null)
        renderer.setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
        renderer.setEnableHardwareScaler(true)
    }

    private fun parseIce(arr: JSONArray): List<PeerConnection.IceServer> = (0 until arr.length()).map { i ->
        val o = arr.getJSONObject(i)
        val urls = o.get("urls").let { u -> if (u is JSONArray) (0 until u.length()).map { u.getString(it) } else listOf(u.toString()) }
        PeerConnection.IceServer.builder(urls)
            .setUsername(o.optString("username", ""))
            .setPassword(o.optString("credential", ""))
            .createIceServer()
    }

    private fun newPeer() {
        pc?.dispose()
        inputCh = null; controlCh = null; prevLost = -1
        val cfg = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        pc = factory.createPeerConnection(cfg, object : PeerConnection.Observer {
            override fun onSignalingChange(s: PeerConnection.SignalingState?) {}
            override fun onIceConnectionChange(s: PeerConnection.IceConnectionState?) {}
            override fun onIceConnectionReceivingChange(b: Boolean) {}
            override fun onIceGatheringChange(s: PeerConnection.IceGatheringState?) {}
            override fun onIceCandidatesRemoved(c: Array<out IceCandidate>?) {}
            override fun onAddStream(s: MediaStream?) {}
            override fun onRemoveStream(s: MediaStream?) {}
            override fun onRenegotiationNeeded() {}

            override fun onIceCandidate(c: IceCandidate) {
                sendSignal(JSONObject().put("type", "ice").put("candidate", c.sdp).put("sdpMLineIndex", c.sdpMLineIndex))
            }

            override fun onTrack(t: RtpTransceiver) {
                val track = t.receiver.track()
                if (track is VideoTrack) main.post { track.addSink(renderer) }
            }

            override fun onConnectionChange(s: PeerConnection.PeerConnectionState) {
                main.post {
                    when (s) {
                        PeerConnection.PeerConnectionState.CONNECTED -> { setStatus(""); reconnectAttempt = 0 }
                        PeerConnection.PeerConnectionState.DISCONNECTED -> setStatus("Conexión inestable…")
                        PeerConnection.PeerConnectionState.FAILED -> setStatus("No se pudo conectar (firewall/TURN)")
                        else -> {}
                    }
                }
            }

            override fun onDataChannel(dc: DataChannel) {
                main.post {
                    when (dc.label()) {
                        "input" -> inputCh = dc
                        "control" -> {
                            controlCh = dc
                            dc.registerObserver(object : DataChannel.Observer {
                                override fun onBufferedAmountChange(p: Long) {}
                                override fun onStateChange() {
                                    if (dc.state() == DataChannel.State.OPEN) control(JSONObject().put("t", "keyframe"))
                                }
                                override fun onMessage(b: DataChannel.Buffer) {
                                    val bytes = ByteArray(b.data.remaining()).also { b.data.get(it) }
                                    val m = runCatching { JSONObject(String(bytes)) }.getOrNull() ?: return
                                    main.post { onControl(m) }
                                }
                            })
                        }
                    }
                }
            }
        })
    }

    private open class Sdp : SdpObserver {
        override fun onCreateSuccess(d: SessionDescription) {}
        override fun onSetSuccess() {}
        override fun onCreateFailure(e: String?) {}
        override fun onSetFailure(e: String?) {}
    }

    private fun onOffer(sdp: String) {
        offerMids = Regex("^a=mid:(\\S+)", RegexOption.MULTILINE).findAll(sdp).map { it.groupValues[1] }.toList()
        newPeer()
        val p = pc ?: return
        p.setRemoteDescription(object : Sdp() {
            override fun onSetSuccess() {
                p.createAnswer(object : Sdp() {
                    override fun onCreateSuccess(d: SessionDescription) {
                        p.setLocalDescription(object : Sdp() {
                            override fun onSetSuccess() { sendSignal(JSONObject().put("type", "answer").put("sdp", d.description)) }
                        }, d)
                    }
                    override fun onCreateFailure(e: String?) { main.post { setStatus("Error WebRTC: $e") } }
                }, MediaConstraints())
            }
            override fun onSetFailure(e: String?) { main.post { setStatus("Error WebRTC: $e") } }
        }, SessionDescription(SessionDescription.Type.OFFER, sdp))
    }

    // ------------------------------------------------------------ señalización
    private fun connectSignal() {
        if (closed) return
        val url = "$signalUrl?role=client&token=${prefs.token}"
        ws = Api.http.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                val m = runCatching { JSONObject(text) }.getOrNull() ?: return
                main.post { onSignal(m) }
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                main.post { onWsClosed(code) }
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, r: Response?) {
                main.post { onWsClosed(r?.code ?: 0) }
            }
        })
    }

    private fun onWsClosed(code: Int) {
        if (closed) return
        when (code) {
            4403, 403 -> end("La sesión ya no existe")
            4409 -> end("Has abierto esta partida en otro dispositivo")
            else -> {
                setStatus("Reconectando…")
                val delayMs = minOf(1000L shl minOf(reconnectAttempt++, 4), 10_000L)
                main.postDelayed({ connectSignal() }, delayMs)
            }
        }
    }

    private fun sendSignal(m: JSONObject) { ws?.send(m.toString()) }

    private fun onSignal(m: JSONObject) {
        when (m.optString("type")) {
            "peer-joined" -> if (m.optString("role") == "worker") setStatus("Conectando tu mando…")
            "queue" -> showQueue(m.optInt("position", 1))
            "offer" -> onOffer(m.getString("sdp"))
            "ice" -> {
                val cand = m.optString("candidate"); if (cand.isEmpty()) return
                val idx = m.optInt("sdpMLineIndex")
                pc?.addIceCandidate(IceCandidate(offerMids.getOrElse(idx) { "" }, idx, cand))
            }
            "peer-left" -> if (m.optString("role") == "worker") setStatus("El nodo se ha desconectado, esperando…")
            "session-state" -> when (m.optString("status")) {
                "starting" -> setStatus("Encendiendo la consola…")
                "failed" -> end(m.optString("error").ifEmpty { "La sesión ha fallado" })
                "ended" -> end("Sesión terminada")
            }
            "bye" -> end(if (m.optString("reason") == "emulator-exit") "El juego se ha cerrado" else "Fin de la sesión")
        }
    }

    // ---------------------------------------------------------------- control
    private fun control(m: JSONObject) {
        val ch = controlCh ?: return
        if (ch.state() == DataChannel.State.OPEN) ch.send(DataChannel.Buffer(ByteBuffer.wrap(m.toString().toByteArray()), false))
    }

    private fun onControl(m: JSONObject) {
        when (m.optString("t")) {
            "hello" -> bitrate = m.optInt("bitrate", bitrate)
            "bitrate" -> bitrate = m.optInt("kbps", bitrate)
            "toast" -> toast(mapOf("savestate" to "Estado guardado", "loadstate" to "Estado cargado",
                "nextslot" to "Siguiente ranura", "screenshot" to "Captura hecha")[m.optString("text")] ?: m.optString("text"))
            "bye" -> onSignal(JSONObject().put("type", "bye").put("reason", m.optString("reason")))
        }
    }

    // ------------------------------------------------------------------ input
    private fun slotFor(e: android.view.InputEvent): Int {
        val dev = e.device ?: return 0
        val isPad = (dev.sources and InputDevice.SOURCE_GAMEPAD == InputDevice.SOURCE_GAMEPAD) ||
            (dev.sources and InputDevice.SOURCE_JOYSTICK == InputDevice.SOURCE_JOYSTICK)
        if (!isPad) return 0
        return deviceSlot.getOrPut(dev.id) { (0 until MAX_PADS).firstOrNull { it !in deviceSlot.values } ?: 0 }
    }

    private fun keyToBit(code: Int): Int? = when (code) {
        KeyEvent.KEYCODE_BUTTON_A, KeyEvent.KEYCODE_DPAD_CENTER -> Btn.A
        KeyEvent.KEYCODE_BUTTON_B, KeyEvent.KEYCODE_1 -> Btn.B
        KeyEvent.KEYCODE_BUTTON_X, KeyEvent.KEYCODE_PROG_RED -> Btn.X
        KeyEvent.KEYCODE_BUTTON_Y, KeyEvent.KEYCODE_PROG_GREEN -> Btn.Y
        KeyEvent.KEYCODE_BUTTON_L1, KeyEvent.KEYCODE_PROG_YELLOW -> Btn.LB
        KeyEvent.KEYCODE_BUTTON_R1, KeyEvent.KEYCODE_PROG_BLUE -> Btn.RB
        KeyEvent.KEYCODE_BUTTON_L2 -> Btn.LT
        KeyEvent.KEYCODE_BUTTON_R2 -> Btn.RT
        KeyEvent.KEYCODE_BUTTON_SELECT, KeyEvent.KEYCODE_2 -> Btn.SELECT
        KeyEvent.KEYCODE_BUTTON_START, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_3 -> Btn.START
        KeyEvent.KEYCODE_BUTTON_THUMBL -> Btn.L3
        KeyEvent.KEYCODE_BUTTON_THUMBR -> Btn.R3
        KeyEvent.KEYCODE_DPAD_UP -> Btn.UP
        KeyEvent.KEYCODE_DPAD_DOWN -> Btn.DOWN
        KeyEvent.KEYCODE_DPAD_LEFT -> Btn.LEFT
        KeyEvent.KEYCODE_DPAD_RIGHT -> Btn.RIGHT
        else -> null
    }

    override fun dispatchKeyEvent(e: KeyEvent): Boolean {
        if (menuOpen) return super.dispatchKeyEvent(e)
        val code = e.keyCode
        if (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_BUTTON_MODE || code == KeyEvent.KEYCODE_ESCAPE || code == KeyEvent.KEYCODE_MENU) {
            if (e.action == KeyEvent.ACTION_UP) openMenu()
            return true
        }
        val bit = keyToBit(code) ?: return super.dispatchKeyEvent(e)
        val slot = slotFor(e)
        // Los mandos que reportan el D-pad como HAT generan además eventos de tecla: no duplicar
        if (e.action == KeyEvent.ACTION_DOWN) keyButtons[slot] = keyButtons[slot] or (1 shl bit)
        else if (e.action == KeyEvent.ACTION_UP) keyButtons[slot] = keyButtons[slot] and (1 shl bit).inv()
        flush(false)
        return true
    }

    override fun dispatchGenericMotionEvent(e: MotionEvent): Boolean {
        if (menuOpen || e.source and InputDevice.SOURCE_JOYSTICK != InputDevice.SOURCE_JOYSTICK || e.action != MotionEvent.ACTION_MOVE) {
            return super.dispatchGenericMotionEvent(e)
        }
        val slot = slotFor(e)
        val (lx, ly) = PadCodec.stick(e.getAxisValue(MotionEvent.AXIS_X), e.getAxisValue(MotionEvent.AXIS_Y))
        val (rx, ry) = PadCodec.stick(e.getAxisValue(MotionEvent.AXIS_Z), e.getAxisValue(MotionEvent.AXIS_RZ))
        axes[slot].apply {
            this.lx = lx; this.ly = ly; this.rx = rx; this.ry = ry
            lt = max(e.getAxisValue(MotionEvent.AXIS_LTRIGGER), e.getAxisValue(MotionEvent.AXIS_BRAKE))
            rt = max(e.getAxisValue(MotionEvent.AXIS_RTRIGGER), e.getAxisValue(MotionEvent.AXIS_GAS))
        }
        val hx = e.getAxisValue(MotionEvent.AXIS_HAT_X); val hy = e.getAxisValue(MotionEvent.AXIS_HAT_Y)
        var hat = 0
        if (hx < -0.5f) hat = hat or (1 shl Btn.LEFT)
        if (hx > 0.5f) hat = hat or (1 shl Btn.RIGHT)
        if (hy < -0.5f) hat = hat or (1 shl Btn.UP)
        if (hy > 0.5f) hat = hat or (1 shl Btn.DOWN)
        hatButtons[slot] = hat
        flush(false)
        return true
    }

    private fun stateFor(slot: Int): PadState {
        val a = axes[slot]
        val s = PadState(keyButtons[slot] or hatButtons[slot], a.lx, a.ly, a.rx, a.ry, a.lt, a.rt)
        if (s.lt > 0.5f) s.buttons = s.buttons or (1 shl Btn.LT)
        if (s.rt > 0.5f) s.buttons = s.buttons or (1 shl Btn.RT)
        if (slot == 0 && touch != null) {
            s.buttons = s.buttons or touchButtons
            if (s.lx == 0f && s.ly == 0f) { s.lx = touchLx; s.ly = touchLy }
        }
        return s
    }

    private fun flush(force: Boolean) {
        val ch = inputCh
        var combo = false
        for (slot in 0 until MAX_PADS) {
            val s = stateFor(slot)
            if ((s.buttons and 0x300) == 0x300) combo = true  // Select + Start
            val active = slot == 0 || deviceSlot.containsValue(slot)
            if (!active) continue
            if (force || s != last[slot]) {
                last[slot] = s
                seq[slot] = (seq[slot] + 1) and 0xffff
                if (ch != null && ch.state() == DataChannel.State.OPEN) {
                    ch.send(DataChannel.Buffer(ByteBuffer.wrap(PadCodec.encode(slot, s, seq[slot])), true))
                }
            }
        }
        val now = System.currentTimeMillis()
        if (combo) {
            if (comboSince == 0L) comboSince = now else if (now - comboSince > 1000) { comboSince = 0; openMenu() }
        } else comboSince = 0
    }

    private val keepalive = object : Runnable {
        override fun run() {
            if (!menuOpen) flush(true)
            main.postDelayed(this, KEEPALIVE_MS)
        }
    }

    private fun releaseAll() {
        keyButtons.fill(0); hatButtons.fill(0); axes.forEach { it.lx = 0f; it.ly = 0f; it.rx = 0f; it.ry = 0f; it.lt = 0f; it.rt = 0f }
        touchButtons = 0; touchLx = 0f; touchLy = 0f
        flush(true)
    }

    // ------------------------------------------------------------------- menú
    private fun openMenu() {
        if (menuOpen || isFinishing) return
        releaseAll()
        menuOpen = true
        val items = arrayOf(
            "Continuar", "Guardar estado", "Cargar estado", "Siguiente ranura",
            "Calidad: automática", "Calidad: 4 Mbps", "Calidad: 8 Mbps", "Calidad: 15 Mbps",
            if (showStats) "Ocultar estadísticas" else "Mostrar estadísticas",
            if (touch?.visibility == View.VISIBLE) "Ocultar controles táctiles" else "Mostrar controles táctiles",
            "Salir sin cerrar (seguir en otro dispositivo)", "Cerrar el juego",
        )
        AlertDialog.Builder(this)
            .setTitle("Menú")
            .setItems(items) { _, which ->
                when (which) {
                    1 -> control(JSONObject().put("t", "savestate"))
                    2 -> control(JSONObject().put("t", "loadstate"))
                    3 -> control(JSONObject().put("t", "nextslot"))
                    4 -> manualBitrate = 0
                    5, 6, 7 -> { manualBitrate = intArrayOf(4000, 8000, 15000)[which - 5]; control(JSONObject().put("t", "bitrate").put("kbps", manualBitrate)) }
                    8 -> { showStats = !showStats; stats.visibility = if (showStats) View.VISIBLE else View.GONE }
                    9 -> touch?.let { it.visibility = if (it.visibility == View.VISIBLE) View.GONE else View.VISIBLE }
                    10 -> finish()
                    11 -> {
                        control(JSONObject().put("t", "quit"))
                        lifecycleScope.launch { runCatching { api.delete("/api/sessions/$sessionId") }; finish() }
                    }
                }
            }
            .setOnDismissListener { menuOpen = false; immersive() }
            .show()
    }

    // ------------------------------------------------------------ stats / ABR
    private val statsLoop = object : Runnable {
        override fun run() {
            pollStats()
            main.postDelayed(this, 2000)
        }
    }

    private fun pollStats() {
        val p = pc ?: return
        p.getStats { report ->
            val v = report.statsMap.values.firstOrNull { it.type == "inbound-rtp" && it.members["kind"] == "video" } ?: return@getStats
            val lost = (v.members["packetsLost"] as? Number)?.toLong() ?: 0L
            val recv = (v.members["packetsReceived"] as? Number)?.toLong() ?: 0L
            val bytes = (v.members["bytesReceived"] as? Number)?.toLong() ?: 0L
            val frames = (v.members["framesDecoded"] as? Number)?.toLong() ?: 0L
            val ts = v.timestampUs / 1e6
            val pair = report.statsMap.values.firstOrNull { it.type == "candidate-pair" && it.members["nominated"] == true && it.members["state"] == "succeeded" }
            val rtt = ((pair?.members?.get("currentRoundTripTime") as? Number)?.toDouble() ?: 0.0) * 1000
            main.post {
                if (prevLost >= 0 && ts > prevTs) {
                    val dLost = lost - prevLost; val dRecv = recv - prevRecv; val dt = ts - prevTs
                    val loss = if (dLost + dRecv > 0) dLost.toDouble() / (dLost + dRecv) else 0.0
                    val kbps = ((bytes - prevBytes) * 8 / 1000.0 / dt).roundToInt()
                    val fps = ((frames - prevFrames) / dt).roundToInt()
                    var target = when {
                        loss > 0.02 -> max(ABR_MIN, (bitrate * 0.75).roundToInt())
                        loss < 0.005 && kbps > bitrate * 0.6 -> minOf(ABR_MAX, bitrate + 500)
                        else -> bitrate
                    }
                    if (manualBitrate > 0) target = manualBitrate
                    if (abs(target - bitrate) >= 250) control(JSONObject().put("t", "bitrate").put("kbps", target))
                    stats.text = "$fps fps · ${"%.1f".format(kbps / 1000.0)} Mbps (obj. ${"%.1f".format(bitrate / 1000.0)}) · " +
                        "RTT ${rtt.roundToInt()} ms · pérdida ${"%.1f".format(loss * 100)}%"
                }
                prevLost = lost; prevRecv = recv; prevBytes = bytes; prevFrames = frames; prevTs = ts
            }
        }
    }

    // ------------------------------------------------------------------- fin
    private fun end(reason: String) {
        if (closed) return
        closed = true
        teardown()
        AlertDialog.Builder(this).setTitle("Partida terminada").setMessage(reason)
            .setPositiveButton("Volver") { _, _ -> finish() }
            .setOnCancelListener { finish() }
            .show()
    }

    private fun teardown() {
        main.removeCallbacksAndMessages(null)
        runCatching { ws?.close(1000, null) }
        ws = null
        runCatching { pc?.dispose() }  // dispose() también cierra
        pc = null
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) immersive()
    }

    override fun onDestroy() {
        closed = true
        teardown()
        renderer.release()
        factory.dispose()
        egl.release()
        super.onDestroy()
    }
}
