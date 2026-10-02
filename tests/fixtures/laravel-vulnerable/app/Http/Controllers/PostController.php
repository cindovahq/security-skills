<?php

namespace App\Http\Controllers;

use App\Models\Post;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class PostController extends Controller
{
    public function index(Request $request)
    {
        $q = $request->input('q', '');

        $posts = Post::query()
            ->whereRaw('published_at <= ?', [now()])
            ->whereRaw("title LIKE '%{$q}%'")
            ->latest()
            ->paginate(20);

        return view('posts.index', compact('posts'));
    }

    public function show(Post $post)
    {
        $post->load('comments', 'user');

        return view('posts.show', compact('post'));
    }

    public function destroy(Post $post)
    {
        Gate::authorize('delete', $post);

        $post->delete();

        return redirect('/posts');
    }
}
