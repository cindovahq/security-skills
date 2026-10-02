import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import '../models/models.dart';

class LocalDb {
  Database? _db;

  Future<Database> _open() async {
    if (_db != null) return _db!;
    final path = p.join(await getDatabasesPath(), 'orders.db');
    _db = await openDatabase(
      path,
      version: 1,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE orders (
            id TEXT PRIMARY KEY,
            customer_id TEXT,
            total REAL,
            status TEXT,
            delivery_address TEXT,
            customer_phone TEXT
          )''');
      },
    );
    return _db!;
  }

  Future<void> cacheOrders(List<CustomerOrder> orders) async {
    final db = await _open();
    final batch = db.batch();
    for (final o in orders) {
      batch.insert('orders', o.toRow(), conflictAlgorithm: ConflictAlgorithm.replace);
    }
    await batch.commit(noResult: true);
  }

  Future<List<Map<String, Object?>>> cachedOrders() async {
    final db = await _open();
    return db.query('orders', orderBy: 'id DESC');
  }
}
