<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;

class AvatarController extends Controller
{
    public function store(Request $request)
    {
        $request->validate([
            'avatar' => ['required', 'file', 'max:2048'],
        ]);

        $file = $request->file('avatar');
        $path = $file->storeAs('avatars', $file->getClientOriginalName(), 'public');

        $request->user()->update(['avatar_path' => $path]);

        return back();
    }
}
