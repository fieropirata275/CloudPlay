package it.neurofix.cloudplay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Adaptador de PS2 genérico tal y como lo ve Android: botones BUTTON_1..12, cruceta en HAT_X/HAT_Y, stick derecho Z/RZ */
class PadMapperTest {
    private val B1 = 188 // KeyEvent.KEYCODE_BUTTON_1
    private val X = 0; private val Y = 1; private val Z = 11; private val RZ = 14; private val HX = 15; private val HY = 16
    private val rest = mapOf(X to 0f, Y to 0f, Z to 0f, RZ to 0f, HX to 0f, HY to 0f)

    private fun runWizard(): String {
        var done: String? = null
        val w = PadWizard("ps2", { _, _, _ -> }, { done = it })
        w.start()
        w.onMotion(rest)
        fun key(n: Int) { w.onKey(B1 + n, true); w.onKey(B1 + n, false) }
        fun axis(a: Int, v: Float) { w.onMotion(rest + (a to v)); w.onMotion(rest) }
        listOf(2, 1, 3, 0, 6, 7, 4, 5, 8, 9).forEach { key(it) }  // ✕ ◯ □ △ L1 R1 L2 R2 SELECT START
        axis(HY, -1f); axis(HY, 1f); axis(HX, -1f); axis(HX, 1f)   // cruceta
        axis(X, 1f); axis(Y, 1f); axis(Z, 1f); axis(RZ, -1f)     // sticks (RZ invertido)
        key(10); key(11)                                         // L3 R3
        return done ?: error("el asistente no terminó")
    }

    @Test fun wizardAndMapping() {
        val map = runWizard()
        assertTrue(map, map.contains("0:k190"))
        assertTrue(map, map.contains("12:a16-"))
        assertTrue(map, map.contains("ry:a14~"))
        assertTrue(map, map.contains("lt:k192"))
        val pad = MappedPad(map)
        pad.onMotion(rest)
        assertTrue(pad.onKey(B1 + 2, true))                 // ✕
        pad.onKey(B1 + 4, true)                             // L2
        pad.onMotion(mapOf(HX to -1f, HY to 1f, RZ to -0.6f))  // abajo-izquierda + stick derecho abajo
        val s = pad.state()
        assertEquals(1, s.buttons and 1)                    // ✕ -> bit 0
        assertTrue(s.buttons and (1 shl Btn.LT) != 0)
        assertTrue(s.buttons and (1 shl Btn.DOWN) != 0 && s.buttons and (1 shl Btn.LEFT) != 0)
        assertEquals(0, s.buttons and (1 shl Btn.UP))
        assertTrue("ry=${s.ry}", s.ry > 0.4f)
        assertEquals(1f, s.lt, 0f)
    }

    @Test fun releasingStickDoesNotFillNextStep() {
        var step: PadWizard.Step? = null
        val w = PadWizard("std", { s, _, _ -> step = s }, { })
        w.start(); w.onMotion(rest)
        repeat(14) { w.skip() }
        assertEquals("lx", step?.slot)
        w.onMotion(rest + (X to 1f))
        assertEquals("ly", step?.slot)
        w.onMotion(rest)                                    // soltar
        assertEquals("ly", step?.slot)
        assertEquals(null, w.map["ly"])
        w.onMotion(rest + (Y to 1f))
        assertNotNull(w.map["ly"])
    }

    @Test fun analogTriggerOnAxis() {
        val pad = MappedPad("lt:a17:0.00:1")                // AXIS_LTRIGGER de 0 a 1
        pad.onMotion(mapOf(17 to 0.5f))
        assertEquals(0.5f, pad.state().lt, 0.001f)
    }
}
