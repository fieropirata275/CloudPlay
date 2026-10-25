package it.neurofix.cloudplay

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import kotlin.math.hypot
import kotlin.math.min

/**
 * Mando en pantalla multitáctil: stick izquierdo analógico, D-pad, ABXY, LB/RB/LT/RT y Select/Start.
 * Se puede deslizar el dedo entre botones (útil para combos). Emite el estado completo en cada cambio.
 */
class TouchControlsView(ctx: Context, private val onChange: (buttons: Int, lx: Float, ly: Float) -> Unit) : View(ctx) {

    private class Key(val bit: Int, val label: String) {
        var cx = 0f; var cy = 0f; var r = 0f
        fun hit(x: Float, y: Float, slack: Float = 1.25f) = hypot(x - cx, y - cy) <= r * slack
    }

    private val keys = listOf(
        Key(Btn.A, "A"), Key(Btn.B, "B"), Key(Btn.X, "X"), Key(Btn.Y, "Y"),
        Key(Btn.UP, "▲"), Key(Btn.DOWN, "▼"), Key(Btn.LEFT, "◀"), Key(Btn.RIGHT, "▶"),
        Key(Btn.LB, "LB"), Key(Btn.RB, "RB"), Key(Btn.LT, "LT"), Key(Btn.RT, "RT"),
        Key(Btn.SELECT, "SEL"), Key(Btn.START, "START"),
    )
    private val byBit = keys.associateBy { it.bit }

    private var stickCx = 0f; private var stickCy = 0f; private var stickR = 0f
    private var stickPointer = -1
    private var lx = 0f; private var ly = 0f
    private val pointerKey = HashMap<Int, Key>()
    private var lastButtons = 0

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(70, 255, 255, 255) }
    private val pressed = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(150, 124, 242, 154) }
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 3f; color = Color.argb(90, 255, 255, 255) }
    private val label = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(200, 255, 255, 255); textAlign = Paint.Align.CENTER; isFakeBoldText = true }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        val u = min(w, h) / 10f
        label.textSize = u * 0.42f
        fun place(bit: Int, x: Float, y: Float, r: Float) = byBit.getValue(bit).apply { cx = x; cy = y; this.r = r }
        // Stick abajo-izquierda, D-pad encima
        stickCx = w * 0.14f; stickCy = h - u * 2.6f; stickR = u * 1.5f
        val dx = w * 0.14f; val dy = h - u * 6.2f; val ds = u * 0.85f
        place(Btn.UP, dx, dy - ds, u * 0.5f); place(Btn.DOWN, dx, dy + ds, u * 0.5f)
        place(Btn.LEFT, dx - ds, dy, u * 0.5f); place(Btn.RIGHT, dx + ds, dy, u * 0.5f)
        // ABXY en rombo abajo-derecha (disposición Xbox)
        val fx = w - w * 0.14f; val fy = h - u * 3.2f; val fs = u * 1.15f
        place(Btn.A, fx, fy + fs, u * 0.62f); place(Btn.B, fx + fs, fy, u * 0.62f)
        place(Btn.X, fx - fs, fy, u * 0.62f); place(Btn.Y, fx, fy - fs, u * 0.62f)
        // Gatillos arriba
        place(Btn.LT, u * 1.0f, u * 0.9f, u * 0.6f); place(Btn.LB, u * 2.5f, u * 0.9f, u * 0.6f)
        place(Btn.RB, w - u * 2.5f, u * 0.9f, u * 0.6f); place(Btn.RT, w - u * 1.0f, u * 0.9f, u * 0.6f)
        place(Btn.SELECT, w / 2f - u * 1.1f, h - u * 0.7f, u * 0.5f); place(Btn.START, w / 2f + u * 1.1f, h - u * 0.7f, u * 0.5f)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
                val i = e.actionIndex
                val id = e.getPointerId(i); val x = e.getX(i); val y = e.getY(i)
                if (stickPointer < 0 && hypot(x - stickCx, y - stickCy) <= stickR * 1.5f) {
                    stickPointer = id; moveStick(x, y)
                } else keys.firstOrNull { it.hit(x, y) }?.let { pointerKey[id] = it }
            }
            MotionEvent.ACTION_MOVE -> for (i in 0 until e.pointerCount) {
                val id = e.getPointerId(i); val x = e.getX(i); val y = e.getY(i)
                if (id == stickPointer) moveStick(x, y)
                else if (pointerKey.containsKey(id)) keys.firstOrNull { it.hit(x, y) }?.let { pointerKey[id] = it }
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP -> {
                val id = e.getPointerId(e.actionIndex)
                if (id == stickPointer) { stickPointer = -1; lx = 0f; ly = 0f }
                pointerKey.remove(id)
            }
            MotionEvent.ACTION_CANCEL -> { pointerKey.clear(); stickPointer = -1; lx = 0f; ly = 0f }
        }
        emit()
        return true
    }

    private fun moveStick(x: Float, y: Float) {
        var nx = (x - stickCx) / stickR; var ny = (y - stickCy) / stickR
        val m = hypot(nx, ny)
        if (m > 1f) { nx /= m; ny /= m }
        lx = nx; ly = ny
    }

    private fun emit() {
        var b = 0
        pointerKey.values.forEach { b = b or (1 shl it.bit) }
        if (b and lastButtons.inv() != 0) performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
        lastButtons = b
        onChange(b, lx, ly)
        invalidate()
    }

    override fun onDraw(c: Canvas) {
        c.drawCircle(stickCx, stickCy, stickR, ring)
        c.drawCircle(stickCx + lx * stickR * 0.6f, stickCy + ly * stickR * 0.6f, stickR * 0.45f,
            if (stickPointer >= 0) pressed else fill)
        for (k in keys) {
            c.drawCircle(k.cx, k.cy, k.r, if (lastButtons and (1 shl k.bit) != 0) pressed else fill)
            c.drawText(k.label, k.cx, k.cy + label.textSize * 0.35f, label)
        }
    }
}
