<?php
defined( 'ABSPATH' ) || exit;

/**
 * "Name your price" support: customers can enter their own amount on product pages.
 */
add_filter( 'woocommerce_add_cart_item_data', function ( $cart_item_data, $product_id ) {
	if ( isset( $_POST['acme_custom_price'] ) ) {
		$cart_item_data['acme_custom_price'] = (float) wp_unslash( $_POST['acme_custom_price'] );
	}
	return $cart_item_data;
}, 10, 2 );

add_action( 'woocommerce_before_calculate_totals', function ( $cart ) {
	foreach ( $cart->get_cart() as $item ) {
		if ( isset( $item['acme_custom_price'] ) ) {
			$item['data']->set_price( $item['acme_custom_price'] );
		}
	}
} );

/**
 * Order status widget on the account page.
 */
add_action( 'wp_ajax_acme_order_status', function () {
	check_ajax_referer( 'acme_frontend' );

	$order = wc_get_order( isset( $_GET['order_id'] ) ? absint( $_GET['order_id'] ) : 0 );
	if ( ! $order ) {
		wp_send_json_error( null, 404 );
	}

	wp_send_json_success( [
		'status'   => $order->get_status(),
		'total'    => $order->get_total(),
		'billing'  => $order->get_address( 'billing' ),
		'shipping' => $order->get_address( 'shipping' ),
	] );
} );

/**
 * Payment notification callback from Acme Pay: /?wc-api=acme_gateway
 */
add_action( 'woocommerce_api_acme_gateway', function () {
	$payload = json_decode( file_get_contents( 'php://input' ), true );
	$order   = wc_get_order( absint( $payload['order_id'] ?? 0 ) );

	if ( $order && 'paid' === ( $payload['status'] ?? '' ) ) {
		$order->payment_complete( sanitize_text_field( $payload['transaction_id'] ?? '' ) );
	}

	status_header( 200 );
	exit;
} );
