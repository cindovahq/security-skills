<?php

use App\Http\Controllers\Api\InternalSyncController;
use App\Http\Controllers\Api\UserController;
use Illuminate\Support\Facades\Route;

Route::post('/internal/sync', [InternalSyncController::class, 'handle']);

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/users', [UserController::class, 'index']);
    Route::get('/user', fn (\Illuminate\Http\Request $request) => $request->user());
});
