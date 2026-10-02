<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Invoice extends Model
{
    protected $fillable = ['number', 'amount', 'billing_address'];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
