package it.neurofix.cloudplay

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.roundToInt
import kotlin.math.sqrt

/** Bits del protocolo (orden W3C "standard gamepad"). Ver docs/PROTOCOL.md */
object Btn {
    const val A = 0; const val B = 1; const val X = 2; const val Y = 3
    const val LB = 4; const val RB = 5; const val LT = 6; const val RT = 7
    const val SELECT = 8; const val START = 9; const val L3 = 10; const val R3 = 11
    const val UP = 12; const val DOWN = 13; const val LEFT = 14; const val RIGHT = 15
}

data class PadState(
    var buttons: Int = 0,
    var lx: Float = 0f, var ly: Float = 0f,
    var rx: Float = 0f, var ry: Float = 0f,
    var lt: Float = 0f, var rt: Float = 0f,
)

object PadCodec {
    const val DEADZONE = 0.12f

    private fun axis(v: Float): Short = (v * 32767f).roundToInt().coerceIn(-32768, 32767).toShort()
    private fun trigger(v: Float): Byte = (v * 255f).roundToInt().coerceIn(0, 255).toByte()

    /** Paquete type=1, 16 bytes little endian. */
    fun encode(pad: Int, s: PadState, seq: Int): ByteArray =
        ByteBuffer.allocate(16).order(ByteOrder.LITTLE_ENDIAN)
            .put(1.toByte())
            .put(pad.toByte())
            .putShort((s.buttons and 0xffff).toShort())
            .putShort(axis(s.lx)).putShort(axis(s.ly))
            .putShort(axis(s.rx)).putShort(axis(s.ry))
            .put(trigger(s.lt)).put(trigger(s.rt))
            .putShort((seq and 0xffff).toShort())
            .array()

    /** Paquete type=2: botón Guide/Home. */
    fun encodeGuide(pad: Int, pressed: Boolean) = byteArrayOf(2, pad.toByte(), if (pressed) 1 else 0, 0)

    /** Zona muerta radial con reescalado, igual que el cliente web. */
    fun stick(x: Float, y: Float): Pair<Float, Float> {
        val m = sqrt(x * x + y * y)
        if (m < DEADZONE) return 0f to 0f
        val s = ((m - DEADZONE) / (1 - DEADZONE)).coerceAtMost(1f) / m
        return x * s to y * s
    }
}
