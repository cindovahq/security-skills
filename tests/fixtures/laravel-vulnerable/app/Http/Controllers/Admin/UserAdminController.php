<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\User;

class UserAdminController extends Controller
{
    public function index()
    {
        return view('admin.users.index', ['users' => User::paginate(50)]);
    }

    public function promote(User $user)
    {
        $user->forceFill(['is_admin' => true])->save();

        return back();
    }
}
