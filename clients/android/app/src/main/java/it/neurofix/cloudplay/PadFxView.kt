package it.neurofix.cloudplay

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Animación de mando conectado / desconectado durante la partida, con el estilo de cada consola (igual que
 * clients/web/js/padfx.js): PS2 azul noche, GameCube índigo con un cubo que entra rodando, Wii blanco con los
 * 4 LEDs que buscan y se queda encendido el del jugador.
 */
class PadFxView(context: Context) : FrameLayout(context) {
    private val dp = context.resources.displayMetrics.density

    private fun px(v: Float) = (v * dp).toInt()

    fun show(platform: String, player: Int, connected: Boolean, wii: Boolean = platform == "wii") {
        val card = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(px(16f), px(12f), px(18f), px(12f))
            alpha = 0f
            translationY = -px(18f).toFloat()
        }
        val (from, to, inkTitle, inkSub) = when (platform) {
            "gc" -> listOf(Color.parseColor("#4330B5"), Color.parseColor("#191055"), Color.parseColor("#ECE7FF"), Color.parseColor("#B9AAFF"))
            "wii" -> listOf(Color.WHITE, Color.parseColor("#E6EDF4"), Color.parseColor("#2B2F36"), Color.parseColor("#1F9BE0"))
            else -> listOf(Color.parseColor("#1F2F9A"), Color.parseColor("#070A24"), Color.parseColor("#E3ECFF"), Color.parseColor("#A9C8FF"))
        }
        card.background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(from, to)).apply {
            cornerRadius = px(if (platform == "wii") 26f else 16f).toFloat()
            if (platform == "wii") setStroke(px(2f), Color.parseColor("#A8DCF8"))
        }
        // Distintivo de la consola a la izquierda
        val badge: View = when (platform) {
            "gc" -> View(context).apply {
                background = GradientDrawable().apply { setColor(Color.parseColor("#9C8AFF")); cornerRadius = px(3f).toFloat() }
                translationX = -px(160f).toFloat(); rotation = -450f
                animate().translationX(0f).rotation(0f).setDuration(950).setStartDelay(80).start()
            }
            "wii" -> LinearLayout(context).apply {
                val me = (player - 1).mod(4)
                repeat(4) { i ->
                    val led = View(context).apply { background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.parseColor("#C8D2DB")) } }
                    addView(led, LinearLayout.LayoutParams(px(9f), px(9f)).apply { marginEnd = px(5f) })
                    if (connected) ValueAnimator.ofInt(0, 6).apply {
                        duration = 1500
                        addUpdateListener { a ->
                            val step = a.animatedValue as Int
                            val on = if (step >= 6) i == me else step % 2 == 0
                            (led.background as GradientDrawable).setColor(Color.parseColor(if (on) "#36B4FF" else "#C8D2DB"))
                        }
                        start()
                    }
                }
            }
            else -> LinearLayout(context).apply {
                repeat(5) { i ->
                    val bar = View(context).apply { setBackgroundColor(if (connected) Color.parseColor("#8FB8FF") else Color.parseColor("#FF5A6E")); pivotY = px(26f).toFloat() }
                    addView(bar, LinearLayout.LayoutParams(px(4f), px(26f)).apply { marginEnd = px(3f) })
                    if (connected) ValueAnimator.ofFloat(0.15f, 1f).apply {
                        duration = 650; startDelay = i * 70L; repeatMode = ValueAnimator.REVERSE; repeatCount = 4
                        addUpdateListener { bar.scaleY = it.animatedValue as Float }
                        start()
                    } else bar.scaleY = 0.15f
                }
            }
        }
        card.addView(badge, if (platform == "gc") LinearLayout.LayoutParams(px(22f), px(22f)) else LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        val texts = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(px(14f), 0, 0, 0) }
        val who = when {
            wii && platform == "wii" -> "Wiimote $player"
            platform == "gc" -> "Puerto $player"
            else -> "Mando $player"
        }
        texts.addView(TextView(context).apply {
            text = if (platform == "ps2") who.uppercase() else who
            setTextColor(inkTitle); textSize = 16f; typeface = Typeface.DEFAULT_BOLD
            if (platform == "ps2") letterSpacing = 0.12f
        })
        texts.addView(TextView(context).apply {
            text = if (connected) "conectado" else "desconectado"
            setTextColor(if (connected) inkSub else Color.parseColor("#8A96A3")); textSize = 12f
        })
        card.addView(texts)
        addView(card, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.END).apply {
            topMargin = px(16f) + childCount * px(70f); marginEnd = px(16f)
        })
        card.animate().alpha(1f).translationY(0f).setDuration(420).start()
        card.postDelayed({
            card.animate().alpha(0f).translationY(-px(10f).toFloat()).setDuration(400).withEndAction { removeView(card) }.start()
        }, 2900)
    }
}

/** LOCAL LAN MODE: dos consolas que se acercan, un cable que se tiende entre ellas y paquetes yendo y viniendo
 *  (igual que CP.LanFx en el cliente web). */
object LanFx {
    fun on(root: FrameLayout, platform: String, members: Int) = show(root, platform, members, true)
    fun off(root: FrameLayout, platform: String) = show(root, platform, 0, false)

    private fun show(root: FrameLayout, platform: String, members: Int, on: Boolean) {
        val ctx = root.context
        val dp = ctx.resources.displayMetrics.density
        fun px(v: Float) = (v * dp).toInt()
        val accent = Color.parseColor(if (platform == "gc") "#A996FF" else "#74AAFF")
        val green = Color.parseColor("#63F2A6")
        val overlay = FrameLayout(ctx).apply {
            setBackgroundColor(Color.argb(if (on) 215 else 140, if (platform == "gc") 20 else 8, if (platform == "gc") 10 else 12, if (platform == "gc") 60 else 48))
            alpha = 0f
            isClickable = false
        }
        val column = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER }
        if (on) {
            val stage = FrameLayout(ctx)
            val w = px(300f)
            fun console(left: Boolean) = View(ctx).apply {
                background = GradientDrawable().apply {
                    setColor(Color.argb(20, 255, 255, 255)); setStroke(px(2.5f), accent); cornerRadius = px(if (platform == "gc") 9f else 4f).toFloat()
                }
                translationX = (if (left) -1 else 1) * px(260f).toFloat(); rotation = if (left) -10f else 10f; alpha = 0f
                animate().translationX(0f).rotation(0f).alpha(1f).setDuration(900).start()
            }
            val cw = px(if (platform == "gc") 52f else 46f); val ch = px(if (platform == "gc") 52f else 64f)
            stage.addView(console(true), FrameLayout.LayoutParams(cw, ch, Gravity.START or Gravity.CENTER_VERTICAL))
            stage.addView(console(false), FrameLayout.LayoutParams(cw, ch, Gravity.END or Gravity.CENTER_VERTICAL))
            val cable = View(ctx).apply { setBackgroundColor(accent); scaleX = 0f; pivotX = 0f }
            stage.addView(cable, FrameLayout.LayoutParams(w - 2 * cw, px(3f), Gravity.CENTER).apply { leftMargin = 0 })
            cable.animate().scaleX(1f).setStartDelay(850).setDuration(600).start()
            repeat(4) { i ->
                listOf(true, false).forEach { fwd ->
                    val dot = View(ctx).apply {
                        background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(if (fwd) Color.WHITE else green) }
                        alpha = 0f
                    }
                    stage.addView(dot, FrameLayout.LayoutParams(px(8f), px(8f), Gravity.CENTER_VERTICAL or Gravity.START).apply { leftMargin = cw })
                    val span = (w - 2 * cw - px(8f)).toFloat()
                    android.animation.ValueAnimator.ofFloat(0f, 1f).apply {
                        duration = 1100; startDelay = 1300L + i * 220L + (if (fwd) 0 else 110); repeatCount = 2
                        addUpdateListener {
                            val t = it.animatedValue as Float
                            dot.translationX = span * (if (fwd) t else 1 - t)
                            dot.alpha = if (t < 0.1f || t > 0.9f) 0f else 1f
                        }
                        start()
                    }
                }
            }
            column.addView(stage, LinearLayout.LayoutParams(w, px(80f)))
        }
        val title = TextView(ctx).apply {
            text = android.text.SpannableString("LOCAL LAN MODE " + if (on) "ON" else "OFF").apply {
                setSpan(android.text.style.ForegroundColorSpan(if (on) green else Color.parseColor("#FF6B7A")), 15, length, 0)
            }
            setTextColor(Color.WHITE); textSize = if (on) 28f else 20f; typeface = Typeface.DEFAULT_BOLD
            letterSpacing = 0.14f; gravity = Gravity.CENTER; setShadowLayer(24f, 0f, 0f, accent)
            alpha = 0f; scaleX = 0.82f; scaleY = 0.82f
            animate().alpha(1f).scaleX(1f).scaleY(1f).setStartDelay(if (on) 1350 else 0).setDuration(500).start()
        }
        column.addView(title, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = px(18f) })
        if (on) column.addView(TextView(ctx).apply {
            text = "$members consolas en la misma red local"; setTextColor(Color.argb(190, 255, 255, 255)); textSize = 14f
            gravity = Gravity.CENTER; alpha = 0f
            animate().alpha(1f).setStartDelay(1700).setDuration(400).start()
        })
        overlay.addView(column, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        root.addView(overlay, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        overlay.animate().alpha(1f).setDuration(400).start()
        overlay.postDelayed({ overlay.animate().alpha(0f).setDuration(600).withEndAction { root.removeView(overlay) }.start() }, if (on) 4200 else 2000)
    }
}
