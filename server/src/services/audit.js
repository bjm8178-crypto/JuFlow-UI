import { ObjectId } from '../db/mongodb.js';
import { auditEventsRepo } from '../db/repositories/index.js';

export async function appendAudit(db, session, { entity_type, entity_id, action, actor, event_id, from_status = null, to_status = null, reason = null, now = new Date() }) {
  if (db && typeof db.collection === 'function' && typeof db.query !== 'function') {
    return await db.collection('audit_events').insertOne({
      entity_type, entity_id, action, event_id: `${entity_type}:${entity_id}:${event_id}`,
      source_event_id: event_id, from_status, to_status, reason,
      performed_by: new ObjectId(actor.id), performed_role: actor.role_name, created_at: now
    }, { session });
  }

  await auditEventsRepo.create({
    entity_type,
    entity_id,
    action,
    event_id: `${entity_type}:${entity_id}:${event_id}`,
    source_event_id: event_id,
    from_status,
    to_status,
    reason,
    actor: actor.id || actor.username,
    created_at: now
  }, db);
}
