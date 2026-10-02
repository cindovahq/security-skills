<?php

use App\Http\Controllers\Admin\UserAdminController;
use App\Http\Controllers\Auth\LoginController;
use App\Http\Controllers\Auth\RegisterController;
use App\Http\Controllers\AvatarController;
use App\Http\Controllers\DocumentController;
use App\Http\Controllers\InvoiceController;
use App\Http\Controllers\MemberDirectoryController;
use App\Http\Controllers\PostController;
use App\Http\Controllers\PreviewController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\StripeWebhookController;
use Illuminate\Support\Facades\Route;

Route::get('/login', [LoginController::class, 'create'])->name('login');
Route::post('/login', [LoginController::class, 'store'])->middleware('throttle:login');
Route::post('/logout', [LoginController::class, 'destroy'])->middleware('auth');
Route::post('/register', [RegisterController::class, 'store']);

Route::get('/posts', [PostController::class, 'index']);
Route::get('/posts/{post}', [PostController::class, 'show']);

Route::middleware('auth')->group(function () {
    Route::get('/posts/{post}/delete', [PostController::class, 'destroy']);

    Route::get('/invoices/{invoice}', [InvoiceController::class, 'show']);
    Route::get('/members', [MemberDirectoryController::class, 'index']);

    Route::get('/documents/download', [DocumentController::class, 'download']);
    Route::post('/avatar', [AvatarController::class, 'store']);
    Route::post('/link-preview', [PreviewController::class, 'show']);
    Route::patch('/profile', [ProfileController::class, 'update']);
});

Route::middleware('auth')->prefix('admin')->group(function () {
    Route::get('/users', [UserAdminController::class, 'index']);
    Route::post('/users/{user}/promote', [UserAdminController::class, 'promote']);
});

Route::post('/stripe/webhook', [StripeWebhookController::class, 'handle']);
