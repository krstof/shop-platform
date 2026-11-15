package com.slopify.uhr

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/**
 * Schaut im Hintergrund nach neuen Bestellungen (alle 15 Minuten, das kürzeste, was Android erlaubt)
 * und meldet sie. Beim ersten Mal merkt sie sich nur die neueste, damit nicht alte Bestellungen piepen.
 */
class OrderWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        check(applicationContext)
    }

    companion object {
        private const val NAME = "bestellungen-pruefen"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<OrderWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
        }

        fun cancel(context: Context) = WorkManager.getInstance(context).cancelUniqueWork(NAME)

        /** Holt die Liste, meldet Neues und merkt sich die neueste. Auch für „Aktualisieren“. */
        fun check(context: Context, api: Api = Api()): Result {
            val store = Store(context)
            val pairing = store.pairing ?: return Result.success()
            return try {
                val orders = api.orders(pairing.token, pairing.shopId)
                val fresh = newerThan(orders, store.lastSeenId)
                Notifier.notifyNew(context, fresh)
                orders.maxOfOrNull { it.id }?.let { newest ->
                    if (store.lastSeenId == null || newest > (store.lastSeenId ?: "")) store.lastSeenId = newest
                }
                Result.success()
            } catch (e: ApiException) {
                // 401: Token widerrufen (etwa neue Uhr verbunden). Dann nicht weiter versuchen.
                if (e.status == 401) Result.failure() else Result.retry()
            } catch (e: Exception) {
                Result.retry()
            }
        }
    }
}
