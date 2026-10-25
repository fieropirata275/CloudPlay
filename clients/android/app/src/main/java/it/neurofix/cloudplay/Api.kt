package it.neurofix.cloudplay

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class Prefs(ctx: Context) {
    private val sp = ctx.getSharedPreferences("cloudplay", Context.MODE_PRIVATE)

    var server: String
        get() = sp.getString("server", null) ?: BuildConfig.DEFAULT_SERVER
        set(v) = sp.edit().putString("server", v.trim().trimEnd('/')).apply()

    var token: String?
        get() = sp.getString("token", null)
        set(v) = sp.edit().putString("token", v).apply()

    val wsBase: String get() = server.replaceFirst("https://", "wss://").replaceFirst("http://", "ws://")
}

class ApiException(val status: Int, msg: String) : Exception(msg)

class Api(private val prefs: Prefs) {
    companion object {
        val http: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .pingInterval(20, TimeUnit.SECONDS)
            .build()
        private val JSON = "application/json".toMediaType()
    }

    private suspend fun call(method: String, path: String, body: JSONObject? = null): String =
        withContext(Dispatchers.IO) {
            val rb = when {
                body != null -> body.toString().toRequestBody(JSON)
                method == "POST" -> "{}".toRequestBody(JSON)
                else -> null
            }
            val req = Request.Builder().url(prefs.server + path).method(method, rb)
            prefs.token?.let { req.header("Authorization", "Bearer $it") }
            http.newCall(req.build()).execute().use { r ->
                val txt = r.body?.string().orEmpty()
                if (!r.isSuccessful) {
                    val detail = runCatching { JSONObject(txt).optString("detail") }.getOrNull()
                    if (r.code == 401 && !path.startsWith("/api/auth/")) prefs.token = null
                    throw ApiException(r.code, if (detail.isNullOrEmpty()) "HTTP ${r.code}" else detail)
                }
                txt
            }
        }

    suspend fun obj(method: String, path: String, body: JSONObject? = null) = JSONObject(call(method, path, body))
    suspend fun arr(path: String) = JSONArray(call("GET", path))
    suspend fun delete(path: String) { call("DELETE", path) }
}
