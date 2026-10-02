<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\Request;

class MemberDirectoryController extends Controller
{
    public function index(Request $request)
    {
        $members = User::query()
            ->select(['id', 'name', 'website'])
            ->orderBy($request->input('sort', 'name'))
            ->paginate(50);

        return view('members.index', compact('members'));
    }
}
