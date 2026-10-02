<x-layout>
    <article>
        <h1>{{ $post->title }}</h1>

        <p class="author">
            By <a href="{{ $post->user->website }}">{{ $post->user->name }}</a>
        </p>

        <div class="body">
            {!! $post->body !!}
        </div>

        <p class="hint">{!! __('Posted :date', ['date' => e($post->created_at->diffForHumans())]) !!}</p>
    </article>

    <section class="comments">
        @foreach ($post->comments as $comment)
            <div class="comment">
                <strong>{{ $comment->user->name }}</strong>
                {!! Str::markdown($comment->body) !!}
            </div>
        @endforeach
    </section>

    <script>
        window.postMeta = @json(['id' => $post->id, 'title' => $post->title]);
    </script>
</x-layout>
