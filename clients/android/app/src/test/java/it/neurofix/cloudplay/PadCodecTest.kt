package it.neurofix.cloudplay

import org.junit.Assert.assertEquals
import org.junit.Test

/** El mismo estado debe dar EXACTAMENTE los mismos bytes que el cliente web (y lo que decodifica el worker). */
class PadCodecTest {
    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }

    @Test fun matchesWebClientEncoding() {
        val s = PadState(buttons = 4609, lx = -1f, ly = 1f, rx = 0.5f, ry = -0.25f, lt = 1f, rt = 0.2f)
        assertEquals("010101120180ff7f004000e0ff33ffff", hex(PadCodec.encode(1, s, 65535)))
    }

    @Test fun guidePacket() {
        assertEquals("02000100", hex(PadCodec.encodeGuide(0, true)))
    }

    @Test fun deadzone() {
        assertEquals(0f to 0f, PadCodec.stick(0.05f, -0.05f))
        val (x, _) = PadCodec.stick(1f, 0f)
        assertEquals(1f, x, 1e-4f)
    }
}
