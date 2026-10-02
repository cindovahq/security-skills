import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../models/models.dart';

class OrdersRepository {
  final CollectionReference<Map<String, dynamic>> _orders =
      FirebaseFirestore.instance.collection('orders');

  Stream<List<CustomerOrder>> watchMine() {
    final uid = FirebaseAuth.instance.currentUser!.uid;
    return _orders
        .where('customerId', isEqualTo: uid)
        .snapshots()
        .map((s) => s.docs.map((d) => CustomerOrder.fromJson({...d.data(), 'id': d.id})).toList());
  }

  Future<void> markDelivered(String orderId) =>
      _orders.doc(orderId).update({'status': 'delivered'});
}

class ChatRepository {
  CollectionReference<Map<String, dynamic>> _messages(String chatId) => FirebaseFirestore.instance
      .collection('support_chats')
      .doc(chatId)
      .collection('messages');

  Stream<QuerySnapshot<Map<String, dynamic>>> watch(String chatId) =>
      _messages(chatId).orderBy('sentAt').snapshots();

  Future<void> send(String chatId, String text) => _messages(chatId).add({
        'text': text,
        'senderId': FirebaseAuth.instance.currentUser!.uid,
        'sentAt': FieldValue.serverTimestamp(),
      });
}

class UserDocRepository {
  final CollectionReference<Map<String, dynamic>> _users =
      FirebaseFirestore.instance.collection('users');

  Future<void> ensureUserDoc(Profile profile) async {
    final uid = FirebaseAuth.instance.currentUser!.uid;
    final ref = _users.doc(uid);
    if (!(await ref.get()).exists) {
      await ref.set({'email': profile.email, 'role': profile.role});
    }
  }

  Future<List<Map<String, dynamic>>> adminSettings() async {
    final snap = await FirebaseFirestore.instance.collection('admin_settings').get();
    return snap.docs.map((d) => d.data()).toList();
  }
}
