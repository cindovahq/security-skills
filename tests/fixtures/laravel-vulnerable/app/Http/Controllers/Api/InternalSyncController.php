<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\Request;

class InternalSyncController extends Controller
{
    public function handle(Request $request)
    {
        if ($request->header('X-Sync-Key') != env('INTERNAL_SYNC_KEY')) {
            abort(401);
        }

        return response()->json(User::all()->makeVisible('email'));
    }
}
