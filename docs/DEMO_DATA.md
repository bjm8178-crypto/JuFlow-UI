# JuKi demo data

Demo customers have synthetic names, invented addresses labeled "Demo" within Brgy. Saog, and approximate illustrative GPS points; **they are not verified residences or delivery coordinates**. Do not navigate to them for real deliveries.

Seeded sales use `is_test_sale: true`, `source: "demo"`, and stable `transaction_id` values. They are excluded from the default **Real sales** reports and from ordinary cash-register counts. In Admin > Sales and Analytics, select **Test sales** to display the demo transactions. Existing real sales and order history are preserved.

The existing database name (`juflow`), API endpoint, service worker scopes, local storage names, and internal JavaScript identifiers are deliberately unchanged to avoid breaking existing deployments. The brand shown to users is **JuKi**.

Existing shop-address and GPS settings must be verified by the owner before routing real riders. Demo customer coordinates do not establish the shop's actual position.
