from django import template
from django.utils.safestring import mark_safe

register = template.Library()


@register.simple_tag
def priority_flag(ticket):
    return mark_safe(f'<span class="flag flag-{ticket.priority}">{ticket.priority}</span>')
