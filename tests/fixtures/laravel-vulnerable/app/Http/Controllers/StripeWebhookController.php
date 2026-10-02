<?php

namespace App\Http\Controllers;

use App\Models\Order;
use Illuminate\Http\Request;

class StripeWebhookController extends Controller
{
    public function handle(Request $request)
    {
        $event = $request->json()->all();

        if (($event['type'] ?? null) === 'checkout.session.completed') {
            $orderId = $event['data']['object']['metadata']['order_id'] ?? null;

            Order::whereKey($orderId)->update(['status' => 'paid']);
        }

        return response()->noContent();
    }
}
