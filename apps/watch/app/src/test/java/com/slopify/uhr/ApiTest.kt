package com.slopify.uhr

import org.junit.Assert.assertEquals
import org.junit.Test

class ApiTest {
    private val json = """
        {"data":[
          {"id":"0190a0b0-0000-7000-8000-000000000003","orderNumber":"10003","placedAt":"2026-11-15T10:00:00Z",
           "customerName":"Kim Muster","email":"kim@example.org","total":1780,"itemCount":2,
           "status":"open","paymentStatus":"paid","fulfillmentStatus":"unfulfilled"},
          {"id":"0190a0b0-0000-7000-8000-000000000002","orderNumber":"10002","placedAt":"2026-11-14T10:00:00Z",
           "customerName":"","email":"jo@example.org","total":490,"itemCount":1,
           "status":"pending_payment","paymentStatus":"unpaid","fulfillmentStatus":"unfulfilled"}
        ],"page":{"nextCursor":null}}
    """.trimIndent()

    @Test
    fun liestBestellungen() {
        val orders = parseOrders(json)
        assertEquals(listOf("10003", "10002"), orders.map { it.number })
        assertEquals("jo@example.org", orders[1].customer)
        assertEquals("Zu versenden", stateText(orders[0]))
        assertEquals("Wartet auf Zahlung", stateText(orders[1]))
    }

    @Test
    fun meldetNurNeuere() {
        val orders = parseOrders(json)
        assertEquals(emptyList<Order>(), newerThan(orders, null))
        assertEquals(listOf("10003"), newerThan(orders, "0190a0b0-0000-7000-8000-000000000002").map { it.number })
    }

    @Test
    fun liestKopplung() {
        val p = parsePairing("""{"token":"shp_at_x","shopId":"s","shopName":"Teeladen"}""")
        assertEquals("Teeladen", p.shopName)
    }
}
