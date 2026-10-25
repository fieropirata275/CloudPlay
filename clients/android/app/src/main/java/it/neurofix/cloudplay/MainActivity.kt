package it.neurofix.cloudplay

import android.app.AlertDialog
import android.app.UiModeManager
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : AppCompatActivity() {
    private lateinit var prefs: Prefs
    private lateinit var api: Api
    private lateinit var root: FrameLayout
    private var pollJob: Job? = null
    private val isTv by lazy {
        (getSystemService(UI_MODE_SERVICE) as UiModeManager).currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        api = Api(prefs)
        root = FrameLayout(this)
        setContentView(root)
    }

    override fun onResume() {
        super.onResume()
        route()
    }

    private fun route() {
        pollJob?.cancel()
        when {
            prefs.server.isBlank() -> showServer()
            prefs.token == null -> showLogin()
            else -> showLibrary()
        }
    }

    // ------------------------------------------------------------------ UI helpers
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun text(s: String, size: Float = 16f, bold: Boolean = false, color: Int = Color.parseColor("#EEF0F6")) =
        TextView(this).apply {
            this.text = s
            textSize = size
            setTextColor(color)
            if (bold) typeface = Typeface.DEFAULT_BOLD
        }

    private fun button(label: String, primary: Boolean = false, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        setTextColor(if (primary) Color.parseColor("#062411") else Color.parseColor("#EEF0F6"))
        background = focusableBg(if (primary) "#7CF29A" else "#1A1D28", 12)
        setPadding(dp(18), dp(10), dp(18), dp(10))
        setOnClickListener { onClick() }
    }

    /** Fondo con borde verde al tener foco: imprescindible para navegar con el mando de la tele. */
    private fun focusableBg(color: String, radius: Int) = android.graphics.drawable.StateListDrawable().apply {
        val normal = GradientDrawable().apply { setColor(Color.parseColor(color)); cornerRadius = dp(radius).toFloat() }
        val focused = GradientDrawable().apply {
            setColor(Color.parseColor(color)); cornerRadius = dp(radius).toFloat()
            setStroke(dp(3), Color.parseColor("#7CF29A"))
        }
        addState(intArrayOf(android.R.attr.state_focused), focused)
        addState(intArrayOf(), normal)
    }

    private fun column(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
        setPadding(dp(24), dp(40), dp(24), dp(24))
    }

    private fun setScreen(v: View) {
        root.removeAllViews()
        root.addView(v, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }

    private fun gap(h: Int = 12) = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(h)) }

    private fun logo(size: Float = 34f) = text("", size, true).apply {
        text = android.text.SpannableString("CloudPlay").apply {
            setSpan(android.text.style.ForegroundColorSpan(Color.parseColor("#7CF29A")), 5, 9, 0)
        }
    }

    // --------------------------------------------------------------------- servidor
    private fun showServer() {
        val col = column()
        val input = EditText(this).apply {
            hint = "https://play.example.com"
            setText(prefs.server)
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine()
        }
        col.addView(logo()); col.addView(gap(24))
        col.addView(text("Servidor de CloudPlay"))
        col.addView(input, LinearLayout.LayoutParams(dp(420), ViewGroup.LayoutParams.WRAP_CONTENT))
        col.addView(gap())
        col.addView(button("Guardar", true) {
            prefs.server = input.text.toString()
            route()
        })
        setScreen(ScrollView(this).apply { addView(col) })
        input.requestFocus()
    }

    // ------------------------------------------------------------------------ login
    private fun showLogin() {
        val col = column()
        col.addView(logo()); col.addView(gap(20))

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            background = GradientDrawable().apply { setColor(Color.parseColor("#12141C")); cornerRadius = dp(14).toFloat() }
            setPadding(dp(24), dp(20), dp(24), dp(20))
        }
        val url = text("…", 16f, true, Color.parseColor("#4FD1FF"))
        val code = text("····-····", 40f, true).apply { typeface = Typeface.MONOSPACE; letterSpacing = 0.1f }
        card.addView(text("Desde tu móvil, entra en", 14f, color = Color.GRAY))
        card.addView(url)
        card.addView(gap(8))
        card.addView(text("e introduce este código", 14f, color = Color.GRAY))
        card.addView(code)
        col.addView(card)
        col.addView(gap(20))

        val form = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; visibility = if (isTv) View.GONE else View.VISIBLE }
        val email = EditText(this).apply { hint = "Email"; inputType = InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS; setSingleLine() }
        val pass = EditText(this).apply { hint = "Contraseña"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD; setSingleLine() }
        form.addView(email); form.addView(pass)
        form.addView(button("Entrar", true) {
            lifecycleScope.launch {
                try {
                    val r = api.obj("POST", "/api/auth/login", JSONObject().put("email", email.text.toString()).put("password", pass.text.toString()))
                    prefs.token = r.getString("access_token")
                    route()
                } catch (e: Exception) { toast(e.message ?: "Error") }
            }
        })
        col.addView(form, LinearLayout.LayoutParams(dp(420), ViewGroup.LayoutParams.WRAP_CONTENT))
        if (isTv) col.addView(button("Entrar con email y contraseña") { form.visibility = View.VISIBLE; email.requestFocus() })
        col.addView(gap())
        col.addView(button("Cambiar servidor") { showServer() })
        setScreen(ScrollView(this).apply { addView(col) })

        pollJob = lifecycleScope.launch {
            while (true) {
                try {
                    val d = api.obj("POST", "/api/auth/device/start")
                    code.text = d.getString("user_code")
                    url.text = d.getString("verification_uri").replace(Regex("^https?://"), "")
                    val until = System.currentTimeMillis() + d.getLong("expires_in") * 1000
                    while (System.currentTimeMillis() < until) {
                        delay(d.getLong("interval") * 1000)
                        val r = try {
                            api.obj("POST", "/api/auth/device/poll", JSONObject().put("device_code", d.getString("device_code")))
                        } catch (e: ApiException) { if (e.status == 410) break else continue }
                        if (r.optString("status") == "approved") {
                            prefs.token = r.getString("access_token")
                            route()
                            return@launch
                        }
                    }
                } catch (e: Exception) {
                    code.text = "sin conexión"
                    url.text = prefs.server
                    delay(5000)
                }
            }
        }
    }

    // -------------------------------------------------------------------- biblioteca
    private var games = JSONArray()
    private var filter = "all"
    private lateinit var adapter: GamesAdapter

    private fun showLibrary() {
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(12), dp(16), 0) }
        val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        top.addView(logo(22f))
        val filters = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(16), 0, 0, 0) }
        listOf("all" to "Todo", "ps2" to "PS2", "gc" to "GameCube", "wii" to "Wii").forEach { (id, label) ->
            filters.addView(button(label) { filter = id; applyFilter() }, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(6) })
        }
        top.addView(HorizontalScrollView(this).apply { addView(filters); isHorizontalScrollBarEnabled = false },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        top.addView(button("Salir") { prefs.token = null; route() })
        layout.addView(top)

        val resume = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; visibility = View.GONE
            setPadding(dp(14), dp(10), dp(14), dp(10))
            background = GradientDrawable().apply { setColor(Color.parseColor("#12141C")); cornerRadius = dp(12).toFloat() }
        }
        layout.addView(gap(8)); layout.addView(resume)

        val grid = RecyclerView(this)
        val span = (resources.displayMetrics.widthPixels / dp(if (isTv) 200 else 150)).coerceAtLeast(2)
        grid.layoutManager = GridLayoutManager(this, span)
        adapter = GamesAdapter(dp(if (isTv) 260 else 200)) { startGame(it) }
        grid.adapter = adapter
        grid.clipToPadding = false
        grid.setPadding(0, dp(12), 0, dp(24))
        layout.addView(grid, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setScreen(layout)

        lifecycleScope.launch {
            try {
                games = api.arr("/api/games")
                applyFilter()
                grid.post { grid.getChildAt(0)?.requestFocus() }
                val active = api.arr("/api/sessions")
                if (active.length() > 0) {
                    val s = active.getJSONObject(0)
                    resume.removeAllViews()
                    resume.addView(text("Partida en curso: " + (s.optJSONObject("game")?.optString("title") ?: ""), 15f),
                        LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                    resume.addView(button("Continuar", true) { openStream(s.getString("id")) })
                    resume.addView(button("Cerrar") { lifecycleScope.launch { runCatching { api.delete("/api/sessions/" + s.getString("id")) }; showLibrary() } })
                    resume.visibility = View.VISIBLE
                    resume.getChildAt(1).requestFocus()
                }
            } catch (e: ApiException) {
                if (e.status == 401) route() else toast(e.message ?: "Error")
            } catch (e: Exception) { toast("Sin conexión con el servidor") }
        }
    }

    private fun applyFilter() {
        val list = (0 until games.length()).map { games.getJSONObject(it) }
            .filter { filter == "all" || it.getString("platform") == filter }
        adapter.submit(list)
    }

    private fun startGame(game: JSONObject) {
        lifecycleScope.launch {
            try {
                val s = api.obj("POST", "/api/sessions", JSONObject().put("game_id", game.getString("id")))
                openStream(s.getString("id"))
            } catch (e: ApiException) {
                if (e.status == 409) {
                    val active = runCatching { api.arr("/api/sessions").getJSONObject(0) }.getOrNull() ?: return@launch
                    AlertDialog.Builder(this@MainActivity)
                        .setTitle("Ya tienes una partida abierta")
                        .setMessage(active.optJSONObject("game")?.optString("title"))
                        .setPositiveButton("Volver a ella") { _, _ -> openStream(active.getString("id")) }
                        .setNeutralButton("Cerrarla y jugar a este") { _, _ ->
                            lifecycleScope.launch {
                                runCatching { api.delete("/api/sessions/" + active.getString("id")) }
                                delay(1500); startGame(game)
                            }
                        }
                        .setNegativeButton("Cancelar", null).show()
                } else AlertDialog.Builder(this@MainActivity).setTitle("No se pudo arrancar").setMessage(e.message)
                    .setPositiveButton("Vale", null).show()
            } catch (e: Exception) { toast("Sin conexión con el servidor") }
        }
    }

    private fun openStream(sessionId: String) {
        startActivity(Intent(this, StreamActivity::class.java).putExtra("session_id", sessionId))
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_LONG).show()

    // ---------------------------------------------------------------------- adapter
    private inner class GamesAdapter(private val tileHeight: Int, private val onPick: (JSONObject) -> Unit) :
        RecyclerView.Adapter<GamesAdapter.VH>() {
        private var items = listOf<JSONObject>()
        private val colors = mapOf(
            "ps2" to intArrayOf(Color.parseColor("#1D3FBB"), Color.parseColor("#0B1650")),
            "gc" to intArrayOf(Color.parseColor("#6A3FC9"), Color.parseColor("#2A145A")),
            "wii" to intArrayOf(Color.parseColor("#28A8D8"), Color.parseColor("#0B3D55")),
        )

        fun submit(list: List<JSONObject>) { items = list; notifyDataSetChanged() }

        inner class VH(val box: FrameLayout, val title: TextView, val badge: TextView) : RecyclerView.ViewHolder(box)

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
            val box = FrameLayout(parent.context).apply {
                isFocusable = true
                isClickable = true
                layoutParams = RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, tileHeight).apply {
                    setMargins(dp(6), dp(6), dp(6), dp(6))
                }
                setOnFocusChangeListener { v, has ->
                    v.animate().scaleX(if (has) 1.06f else 1f).scaleY(if (has) 1.06f else 1f).setDuration(120).start()
                    v.elevation = if (has) dp(8).toFloat() else 0f
                }
            }
            val title = text("", 17f, true).apply { gravity = Gravity.CENTER; setPadding(dp(10), 0, dp(10), 0) }
            val badge = text("", 11f, true).apply { setPadding(dp(6), dp(2), dp(6), dp(2)) }
            box.addView(title, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            box.addView(badge, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM or Gravity.START).apply { setMargins(dp(10), 0, 0, dp(10)) })
            return VH(box, title, badge)
        }

        override fun onBindViewHolder(h: VH, pos: Int) {
            val g = items[pos]
            val p = g.getString("platform")
            val c = colors[p] ?: intArrayOf(Color.DKGRAY, Color.BLACK)
            val normal = GradientDrawable(GradientDrawable.Orientation.TL_BR, c).apply { cornerRadius = dp(14).toFloat() }
            val focused = GradientDrawable(GradientDrawable.Orientation.TL_BR, c).apply {
                cornerRadius = dp(14).toFloat(); setStroke(dp(3), Color.parseColor("#7CF29A"))
            }
            h.box.background = android.graphics.drawable.StateListDrawable().apply {
                addState(intArrayOf(android.R.attr.state_focused), focused); addState(intArrayOf(), normal)
            }
            h.title.text = g.getString("title")
            h.badge.text = g.getString("platform_name")
            h.badge.background = GradientDrawable().apply { setColor(Color.argb(140, 0, 0, 0)); cornerRadius = dp(6).toFloat() }
            h.box.setOnClickListener { onPick(g) }
        }

        override fun getItemCount() = items.size
    }
}
