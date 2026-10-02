from rest_framework import serializers

from accounts.models import User
from support.models import Ticket


class AccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = "__all__"


class TicketSerializer(serializers.ModelSerializer):
    class Meta:
        model = Ticket
        fields = ["id", "title", "body", "status", "priority", "owner", "created_at"]
        read_only_fields = ["owner", "created_at"]
