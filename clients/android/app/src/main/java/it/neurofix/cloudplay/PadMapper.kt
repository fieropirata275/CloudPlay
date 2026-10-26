package it.neurofix.cloudplay

import android.content.Context
import android.view.InputDevice
import android.view.MotionEvent
import kotlin.math.abs

/**
 * Mandos que Android no traduce bien (adaptadores USB de PS2 y GameCube y similares): el jugador dice qué es
 * cada botón con el asistente y queda guardado por modelo de mando (vendor:product). Mismo formato que el
 * cliente web (clients/web/js/pads.js): "slot:token,..." con slot 0..16 (standard gamepad), lx ly rx ry lt rt.
 * Tokens: kN tecla (KeyEvent) · aN eje (MotionEvent.AXIS_*) · aN~ invertido · aN+ / aN- medio eje ·
 * aN:R:E gatillo con reposo R y fondo E.
 */
object PadStore {
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("pads", Context.MODE_PRIVATE)

    fun key(dev: InputDevice): String =
        if (dev.vendorId != 0 || dev.productId != 0) "%04x%04x".format(dev.vendorId, dev.productId) else "d:" + dev.descriptor

    fun load(ctx: Context, dev: InputDevice): String? = prefs(ctx).getString(key(dev), null)
    fun save(ctx: Context, dev: InputDevice, map: String) = prefs(ctx).edit().putString(key(dev), map).apply()
    fun reset(ctx: Context, dev: InputDevice) = prefs(ctx).edit().remove(key(dev)).apply()

    fun isGamepad(dev: InputDevice?): Boolean = dev != null &&
        ((dev.sources and InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD ||
            (dev.sources and InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK)

    /** Valores de todos los ejes del mando en este evento */
    fun axisValues(e: MotionEvent): Map<Int, Float> {
        val out = HashMap<Int, Float>()
        val dev = e.device ?: return out
        for (r in dev.motionRanges) {
            if ((r.source and InputDevice.SOURCE_JOYSTICK) == 0) continue
            out[r.axis] = e.getAxisValue(r.axis)
        }
        return out
    }
}

/** Un mando con mapeo propio: guarda teclas y ejes en bruto y saca el estado estándar */
class MappedPad(map: String) {
    private val tokens = HashMap<String, String>()
    private val keys = HashSet<Int>()
    private val vals = HashMap<Int, Float>()

    init {
        for (pair in map.split(',')) {
            val i = pair.indexOf(':')
            if (i > 0) tokens[pair.substring(0, i)] = pair.substring(i + 1)
        }
    }

    /** true si la tecla es de este mapeo (se consume) */
    fun onKey(code: Int, down: Boolean): Boolean {
        if (tokens.values.none { it == "k$code" }) return false
        if (down) keys.add(code) else keys.remove(code)
        return true
    }

    fun onMotion(v: Map<Int, Float>) { vals.putAll(v) }
    fun release() { keys.clear(); vals.clear() }

    private fun value(tok: String?, stick: Boolean): Float {
        if (tok == null) return 0f
        if (tok.startsWith("k")) return if (tok.substring(1).toIntOrNull() in keys) 1f else 0f
        if (!tok.startsWith("a")) return 0f
        val trig = Regex("""^a(\d+):(-?[\d.]+):(-?[\d.]+)$""").find(tok)
        if (trig != null) {
            val (a, r, e) = trig.destructured
            val t = ((vals[a.toInt()] ?: r.toFloat()) - r.toFloat()) / (e.toFloat() - r.toFloat())
            return t.coerceIn(0f, 1f)
        }
        val m = Regex("""^a(\d+)([+-]?)(~?)$""").find(tok) ?: return 0f
        val (a, half, inv) = m.destructured
        val v = (vals[a.toInt()] ?: 0f) * (if (inv.isEmpty()) 1f else -1f)
        return when (half) {
            "+" -> maxOf(0f, v)
            "-" -> maxOf(0f, -v)
            else -> if (stick) v else (v + 1f) / 2f
        }
    }

    fun state(): PadState {
        val s = PadState()
        for (b in 0..15) if (b != 6 && b != 7 && value(tokens[b.toString()], false) > 0.5f) s.buttons = s.buttons or (1 shl b)
        s.lx = value(tokens["lx"], true); s.ly = value(tokens["ly"], true)
        s.rx = value(tokens["rx"], true); s.ry = value(tokens["ry"], true)
        s.lt = value(tokens["lt"], false); s.rt = value(tokens["rt"], false)
        // gatillo hecho con un botón
        if (tokens["lt"]?.startsWith("k") == true) s.lt = value(tokens["lt"], false)
        if (tokens["rt"]?.startsWith("k") == true) s.rt = value(tokens["rt"], false)
        if (s.lt > 0.5f) s.buttons = s.buttons or (1 shl Btn.LT)
        if (s.rt > 0.5f) s.buttons = s.buttons or (1 shl Btn.RT)
        val (lx, ly) = PadCodec.stick(s.lx, s.ly); s.lx = lx; s.ly = ly
        val (rx, ry) = PadCodec.stick(s.rx, s.ry); s.rx = rx; s.ry = ry
        return s
    }
}

/** Asistente: pide cada botón con el nombre de su consola. Igual que el del cliente web. */
class PadWizard(
    layout: String,
    private val onStep: (Step, Int, Int) -> Unit,
    private val onDone: (String) -> Unit,
) {
    data class Step(val slot: String, val label: String, val optional: Boolean = false)

    companion object {
        val LAYOUTS = mapOf(
            "ps2" to listOf(
                Step("0", "✕ Cruz"), Step("1", "◯ Círculo"), Step("2", "□ Cuadrado"), Step("3", "△ Triángulo"),
                Step("4", "L1"), Step("5", "R1"), Step("lt", "L2"), Step("rt", "R2"), Step("8", "SELECT"), Step("9", "START"),
                Step("12", "Cruceta ↑"), Step("13", "Cruceta ↓"), Step("14", "Cruceta ←"), Step("15", "Cruceta →"),
                Step("lx", "Stick izquierdo hacia la DERECHA"), Step("ly", "Stick izquierdo hacia ABAJO"),
                Step("rx", "Stick derecho hacia la DERECHA", true), Step("ry", "Stick derecho hacia ABAJO", true),
                Step("10", "L3 (hunde el stick izquierdo)", true), Step("11", "R3 (hunde el stick derecho)", true),
            ),
            // Dolphin espera A = Sur, B = Oeste, X = Este, Y = Norte y Z = RB
            "gc" to listOf(
                Step("0", "A (el grande verde)"), Step("2", "B (el rojo)"), Step("1", "X"), Step("3", "Y"), Step("5", "Z"),
                Step("lt", "Gatillo L (hasta el fondo)"), Step("rt", "Gatillo R (hasta el fondo)"), Step("9", "START"),
                Step("12", "Cruceta ↑"), Step("13", "Cruceta ↓"), Step("14", "Cruceta ←"), Step("15", "Cruceta →"),
                Step("lx", "Stick de control hacia la DERECHA"), Step("ly", "Stick de control hacia ABAJO"),
                Step("rx", "C-Stick (amarillo) hacia la DERECHA"), Step("ry", "C-Stick (amarillo) hacia ABAJO"),
            ),
            "std" to listOf(
                Step("0", "A / botón de abajo"), Step("1", "B / botón de la derecha"), Step("2", "X / botón de la izquierda"),
                Step("3", "Y / botón de arriba"), Step("4", "LB / L1"), Step("5", "RB / R1"), Step("lt", "LT / L2"), Step("rt", "RT / R2"),
                Step("8", "Back / Select"), Step("9", "Start"),
                Step("12", "Cruceta ↑"), Step("13", "Cruceta ↓"), Step("14", "Cruceta ←"), Step("15", "Cruceta →"),
                Step("lx", "Stick izquierdo hacia la DERECHA"), Step("ly", "Stick izquierdo hacia ABAJO"),
                Step("rx", "Stick derecho hacia la DERECHA", true), Step("ry", "Stick derecho hacia ABAJO", true),
                Step("10", "Hunde el stick izquierdo", true), Step("11", "Hunde el stick derecho", true),
            ),
        )
    }

    private val steps = LAYOUTS.getValue(layout)
    private var i = -1
    val map = LinkedHashMap<String, String>()
    private val used = HashSet<String>()
    private val keysDown = HashSet<Int>()
    private var rest: Map<Int, Float>? = null
    private var base: Map<Int, Float> = emptyMap()
    private val cur = HashMap<Int, Float>()
    private var waitRelease = true
    var current: Step? = null; private set

    fun start() = next()

    fun skip() = next()

    fun back() {
        if (i <= 0) return
        steps[i - 1].let { prev -> map.remove(prev.slot)?.let { used.remove(usedKey(it)) } }
        i -= 2
        next()
    }

    private fun usedKey(tok: String) = tok.replace(Regex("""[~+-]$|[:=].*$"""), "")

    private fun next() {
        i++
        if (i >= steps.size) { current = null; onDone(map.entries.joinToString(",") { "${it.key}:${it.value}" }); return }
        current = steps[i]
        waitRelease = !atRest()
        if (!waitRelease) base = HashMap(cur)
        onStep(steps[i], i, steps.size)
    }

    private fun atRest(): Boolean {
        if (keysDown.isNotEmpty()) return false
        val r = rest ?: return true
        return cur.all { (a, v) -> abs(v - (r[a] ?: 0f)) <= 0.25f }
    }

    private fun isStick(slot: String) = slot in setOf("lx", "ly", "rx", "ry")

    fun onKey(code: Int, down: Boolean) {
        val step = current ?: return
        if (!down) { keysDown.remove(code); settle(); return }
        if (code in keysDown) return
        if (waitRelease && atRest()) { waitRelease = false; base = HashMap(cur) }
        keysDown.add(code)
        if (!waitRelease && !isStick(step.slot) && "k$code" !in used) assign(step, "k$code")
    }

    fun onMotion(v: Map<Int, Float>) {
        if (rest == null) rest = HashMap(v)
        cur.putAll(v)
        val step = current ?: return
        if (waitRelease) { settle(); return }
        var best = -1; var delta = 0f
        for ((a, value) in cur) {
            val d = value - (base[a] ?: 0f)
            if (abs(d) > abs(delta)) { delta = d; best = a }
        }
        if (best < 0 || abs(delta) < 0.55f) return
        val r = base[best] ?: 0f
        val tok = when {
            isStick(step.slot) -> if ("a$best" in used) return else "a$best" + if (delta > 0) "" else "~"
            step.slot == "lt" || step.slot == "rt" -> "a$best:${"%.2f".format(java.util.Locale.ROOT, r)}:${if (delta > 0) 1 else -1}"
            else -> "a$best" + if (delta > 0) "+" else "-"
        }
        assign(step, tok)
    }

    private fun settle() {
        if (waitRelease && atRest()) { waitRelease = false; base = HashMap(cur) }
    }

    private fun assign(step: Step, tok: String) {
        map[step.slot] = tok
        // los ejes de la cruceta (hat) valen para 4 direcciones: solo se bloquean los de stick
        if (!tok.endsWith("+") && !tok.endsWith("-")) used.add(usedKey(tok))
        waitRelease = true
        next()
    }
}
