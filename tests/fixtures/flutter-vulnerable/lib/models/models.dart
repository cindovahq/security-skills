class CustomerOrder {
  CustomerOrder({
    required this.id,
    required this.customerId,
    required this.total,
    required this.status,
    this.receiptUrl,
    this.deliveryAddress,
    this.customerPhone,
  });

  final String id;
  final String customerId;
  final double total;
  final String status;
  final String? receiptUrl;
  final String? deliveryAddress;
  final String? customerPhone;

  factory CustomerOrder.fromJson(Map<String, dynamic> json) => CustomerOrder(
        id: json['id'] as String,
        customerId: json['customerId'] as String,
        total: (json['total'] as num).toDouble(),
        status: json['status'] as String,
        receiptUrl: json['receiptUrl'] as String?,
        deliveryAddress: json['deliveryAddress'] as String?,
        customerPhone: json['customerPhone'] as String?,
      );

  Map<String, Object?> toRow() => {
        'id': id,
        'customer_id': customerId,
        'total': total,
        'status': status,
        'delivery_address': deliveryAddress,
        'customer_phone': customerPhone,
      };
}

class Profile {
  Profile({required this.id, required this.email, required this.role, this.displayName});

  final String id;
  final String email;
  final String role;
  final String? displayName;

  bool get isAdmin => role == 'admin';

  factory Profile.fromJson(Map<String, dynamic> json) => Profile(
        id: json['id'] as String,
        email: json['email'] as String,
        role: (json['role'] as String?) ?? 'customer',
        displayName: json['displayName'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'email': email,
        'role': role,
        'displayName': displayName,
      };
}
