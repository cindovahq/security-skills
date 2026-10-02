<?php

namespace App\Livewire;

use App\Models\Post;
use Illuminate\Support\Facades\Gate;
use Livewire\Component;

class EditPost extends Component
{
    public int $postId;

    public string $title = '';

    public string $body = '';

    public function mount(Post $post)
    {
        Gate::authorize('update', $post);

        $this->postId = $post->id;
        $this->title = $post->title;
        $this->body = $post->body;
    }

    public function save()
    {
        $this->validate([
            'title' => 'required|string|max:255',
            'body' => 'required|string',
        ]);

        Post::findOrFail($this->postId)->update([
            'title' => $this->title,
            'body' => $this->body,
        ]);
    }

    public function render()
    {
        return view('livewire.edit-post');
    }
}
