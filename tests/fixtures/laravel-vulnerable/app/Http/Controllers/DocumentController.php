<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;

class DocumentController extends Controller
{
    public function download(Request $request)
    {
        $file = $request->input('file');

        return response()->download(storage_path('app/documents/'.$file));
    }
}
