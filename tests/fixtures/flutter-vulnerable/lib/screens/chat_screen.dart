import 'package:flutter/material.dart';

import '../data/repositories.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, required this.chatId});

  final String chatId;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _repo = ChatRepository();
  final _controller = TextEditingController();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Support chat')),
      body: Column(children: [
        Expanded(
          child: StreamBuilder(
            stream: _repo.watch(widget.chatId),
            builder: (context, snap) => ListView(children: [
              for (final d in snap.data?.docs ?? [])
                ListTile(title: Text(d.data()['text'] as String? ?? '')),
            ]),
          ),
        ),
        TextField(
          controller: _controller,
          onSubmitted: (v) {
            _repo.send(widget.chatId, v);
            _controller.clear();
          },
        ),
      ]),
    );
  }
}
