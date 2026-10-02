from django.conf import settings
from django.db import models
from django.utils.html import format_html


class Ticket(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="tickets")
    title = models.CharField(max_length=200)
    body = models.TextField()
    status = models.CharField(max_length=16, default="open")
    priority = models.CharField(max_length=16, default="normal")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.title

    def status_badge(self):
        return format_html('<span class="badge badge-{}">{}</span>', self.status, self.status.title())


class Comment(models.Model):
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)


class Attachment(models.Model):
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="attachments")
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    file = models.FileField(upload_to="attachments/")
    created_at = models.DateTimeField(auto_now_add=True)


class Article(models.Model):
    title = models.CharField(max_length=200)
    body = models.TextField()
    category_id = models.IntegerField(default=0)
    published = models.BooleanField(default=False)
