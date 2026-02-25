/**
 * Review comments persistence for Ralph Loops Management System.
 * Handles reading and writing review comments to the SQLite database.
 */

import { getDatabase } from "./database";
import { createLogger } from "../core/logger";

const log = createLogger("persistence:review-comments");

/**
 * Insert a review comment into the database.
 */
export function insertReviewComment(comment: {
  id: string;
  loopId: string;
  reviewCycle: number;
  commentText: string;
  createdAt: string;
  status?: string;
}): void {
  log.debug("Inserting review comment", { id: comment.id, loopId: comment.loopId, reviewCycle: comment.reviewCycle });
  const db = getDatabase();
  db.run(
    `INSERT INTO review_comments (id, loop_id, review_cycle, comment_text, created_at, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      comment.id,
      comment.loopId,
      comment.reviewCycle,
      comment.commentText,
      comment.createdAt,
      comment.status ?? "pending",
    ]
  );
  log.debug("Review comment inserted", { id: comment.id });
}

/**
 * Get all review comments for a loop.
 * Returns comments ordered by review_cycle DESC, created_at ASC.
 */
export function getReviewComments(loopId: string): Array<{
  id: string;
  loop_id: string;
  review_cycle: number;
  comment_text: string;
  created_at: string;
  status: string;
  addressed_at: string | null;
}> {
  log.debug("Getting review comments", { loopId });
  const db = getDatabase();
  const comments = db.query(
    `SELECT * FROM review_comments 
     WHERE loop_id = ? 
     ORDER BY review_cycle DESC, created_at ASC`
  ).all(loopId) as Array<{
    id: string;
    loop_id: string;
    review_cycle: number;
    comment_text: string;
    created_at: string;
    status: string;
    addressed_at: string | null;
  }>;
  
  log.debug("Review comments retrieved", { loopId, count: comments.length });
  return comments;
}

/**
 * Update the status of all pending comments for a specific loop and review cycle.
 * Used to mark comments as "addressed" when a loop completes.
 */
export function markCommentsAsAddressed(loopId: string, reviewCycle: number, addressedAt: string): void {
  log.debug("Marking comments as addressed", { loopId, reviewCycle });
  const db = getDatabase();
  db.run(
    `UPDATE review_comments 
     SET status = 'addressed', addressed_at = ?
     WHERE loop_id = ? AND review_cycle = ? AND status = 'pending'`,
    [addressedAt, loopId, reviewCycle]
  );
  log.debug("Comments marked as addressed", { loopId, reviewCycle, addressedAt });
}
