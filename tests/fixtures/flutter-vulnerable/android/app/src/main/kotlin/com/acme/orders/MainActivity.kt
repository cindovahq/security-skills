package com.acme.orders

import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterFragmentActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "com.acme.orders/files")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "readReceipt" -> {
                        val name = call.argument<String>("name")
                        val file = File(filesDir, "receipts/$name")
                        if (file.exists()) {
                            result.success(file.readText())
                        } else {
                            result.error("missing", "Receipt not found", null)
                        }
                    }
                    "writeFile" -> {
                        val name = call.argument<String>("name") ?: ""
                        val data = call.argument<String>("data") ?: ""
                        File(filesDir, name).writeText(data)
                        result.success(true)
                    }
                    else -> result.notImplemented()
                }
            }
    }
}
