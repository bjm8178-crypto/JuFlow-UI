import { ObjectId } from '../db/mongodb.js';

export async function appendAudit(db, session, { entity_type, entity_id, action, actor, event_id, from_status = null, to_status = null, reason = null, now = new Date() }) {
  await db.collection('audit_events').insertOne({
    entity_type, entity_id, action, event_id: `${entity_type}:${entity_id}:${event_id}`,
    source_event_id: event_id, from_status, to_status, reason,
    performed_by: new ObjectId(actor.id), performed_role: actor.role_name, created_at: now
  }, { session });
}
