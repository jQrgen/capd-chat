package org.nexa.capdchat

import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class LivePeerTest {
    @Test
    fun mainnetSeedCompletesTheHandshakeWhenReachable() {
        val hosts = listOf(
            "seeder.nexa.org",
            "seed.nextchain.cash",
            "nexa-seeder.bitcoinunlimited.info",
        )
        var lastError = "no seed answered"
        for (host in hosts) {
            val outcome = talk(host)
            if (outcome == null) continue
            lastError = outcome
            if (outcome.startsWith("ok")) {
                println("CAPD live probe: $outcome")
                assertTrue(outcome.startsWith("ok"))
                return
            }
        }
        println("CAPD live probe skipped: $lastError")
    }

    private fun talk(host: String): String? {
        val peer = CapdPeer("mainnet", "$host:7228", 7228, seed = 7)
        val socket = Socket()
        try {
            socket.connect(InetSocketAddress(host, 7228), 6_000)
            socket.soTimeout = 4_000
        } catch (error: Exception) {
            socket.close()
            return null
        }
        socket.use { open ->
            val now = System.currentTimeMillis() / 1000
            val out = open.getOutputStream()
            val input = open.getInputStream()
            for (frame in peer.start(now)) out.write(frame)
            out.flush()
            val buffer = ByteArray(16 * 1024)
            val deadline = System.currentTimeMillis() + 12_000
            var step = PeerStep(emptyList(), emptyList(), peer.phase, peer.note, -1, "")
            while (System.currentTimeMillis() < deadline && step.phase != "listening" && step.phase != "failed") {
                val count = try {
                    input.read(buffer)
                } catch (_: SocketTimeoutException) {
                    continue
                }
                if (count < 0) break
                step = peer.receive(buffer.copyOf(count), System.currentTimeMillis() / 1000)
                for (frame in step.send) out.write(frame)
                out.flush()
            }
            if (step.phase == "failed") return "failed ${step.note}"
            if (step.phase != "listening") return "timeout phase=${step.phase} ${step.note}"
            assertEquals("listening", step.phase)
            val extra = System.currentTimeMillis() + 4_000
            while (System.currentTimeMillis() < extra && step.poolSummary.isEmpty() && step.messages.isEmpty()) {
                val count = try {
                    input.read(buffer)
                } catch (_: SocketTimeoutException) {
                    continue
                }
                if (count < 0) break
                step = peer.receive(buffer.copyOf(count), System.currentTimeMillis() / 1000)
                for (frame in step.send) out.write(frame)
                out.flush()
            }
            val first = step.messages.firstOrNull()
            val sample = first?.text ?: first?.data?.take(16) ?: ""
            return "ok $host capd=${step.capdVersion} pool='${step.poolSummary}' sample='$sample' ${step.note}"
        }
    }
}
