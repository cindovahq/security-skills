<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class PreviewController extends Controller
{
    public function show(Request $request)
    {
        $request->validate(['url' => ['required', 'url']]);

        $response = Http::timeout(5)->get($request->input('url'));

        return response()->json([
            'status' => $response->status(),
            'body' => substr($response->body(), 0, 5000),
        ]);
    }
}
