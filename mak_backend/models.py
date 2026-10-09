"""ORM representation of the shared business database (schema also consumed by D1)."""
from django.db import models


class Product(models.Model):
    id = models.SlugField(primary_key=True, max_length=120)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, default='')
    name_en = models.CharField(max_length=200)
    description_en = models.TextField(blank=True, default='')
    category = models.CharField(max_length=20, choices=[('pipes','مواسير'),('fittings','وصلات'),('poly','بولي بروبلين')])
    price = models.DecimalField(max_digits=12, decimal_places=2)
    image = models.CharField(max_length=1000, blank=True, default='')
    details_ar = models.JSONField(default=dict)
    details_en = models.JSONField(default=dict)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    position = models.IntegerField(default=0)
    version = models.PositiveIntegerField(default=0)
    deleted_at = models.TextField(blank=True, default='')

    class Meta:
        db_table = 'products'
        managed = False  # Versioned shared SQL owns this table, not the separate authentication database.
        ordering = ['position','id']

    def __str__(self):
        return self.name
