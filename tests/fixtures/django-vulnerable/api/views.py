from rest_framework import viewsets
from rest_framework.authentication import TokenAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from support.models import Ticket

from .serializers import AccountSerializer, TicketSerializer


class AccountViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    serializer_class = AccountSerializer


class TicketViewSet(viewsets.ModelViewSet):
    queryset = Ticket.objects.all()
    serializer_class = TicketSerializer
    permission_classes = [IsAuthenticated]

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)


class DeviceSyncView(APIView):
    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        since = request.data.get("since")
        tickets = Ticket.objects.filter(owner=request.user)
        if since:
            tickets = tickets.filter(created_at__gte=since)
        return Response({"tickets": TicketSerializer(tickets, many=True).data})
