// Completion is an incoming cashier event, never an admin or rider action.
window.DeliveryState={
 shop:{lat:14.763649,lng:120.956218,provisional:true},
 completed:o=>Boolean(o.cashierCompletion?.confirmedAt&&o.cashierCompletion?.source==='cashier'),
 active(o){return !this.completed(o)&&['Picked up','On the way','Delivered','Awaiting cashier confirmation'].includes(o.status);},
 label(o){if(this.completed(o))return 'Completed · cashier confirmed';return o.status==='Delivered'?'Awaiting cashier confirmation':o.status;},
 locationLabel(l){if(!l)return 'No rider location received';const age=Date.now()-Date.parse(l.updatedAt);if(!Number.isFinite(age))return 'Location timestamp unavailable';return (age>30000?'Last known location · ':'Last update · ')+new Date(l.updatedAt).toLocaleTimeString();}
};
