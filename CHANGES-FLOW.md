# Flow update

Admin: today's dishes (Dishes page), customers with address + landmark, analytics (Dashboard / Sales),
bell notifications when something sells, order status view (Orders page: Preparing -> On the way -> Delivered),
create cashier accounts (Users page; the single rider account is automatic).

Cashier: Sell tab = today's dishes with + / - (records / undoes a sale, feeds analytics), Orders tab =
status buttons (Preparing / On the way / Delivered) + customer address, Today tab = totals.

Rider: sees customer address, sets On the way, then Delivered.

Changed files: cashier/{pos,orders,today,me}.js, cashier.css, rider/{jobs,history,me,app}.js, app.js (bell),
workflow.js, orders.html, users.html, delivery-state.js, admin-deliveries.js, tests/workflow-api-vm.test.mjs,
dist/ (rebuilt), Mobile/ copies.
