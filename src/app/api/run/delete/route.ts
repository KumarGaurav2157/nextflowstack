// src/app/api/run/delete/route.ts
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// DELETE /api/run/delete?id=xxx        — delete one run
// DELETE /api/run/delete?workflowId=xxx — delete all runs for a workflow
export async function DELETE(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const runId      = searchParams.get("id");
    const workflowId = searchParams.get("workflowId");

    if (runId) {
      // Verify ownership before deleting
      const run = await db.workflowRun.findFirst({ where: { id: runId, userId } });
      if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

      await db.workflowRun.delete({ where: { id: runId } });
      return NextResponse.json({ success: true, deleted: runId });
    }

    if (workflowId) {
      // Delete all runs for this workflow owned by this user
      await db.workflowRun.deleteMany({ where: { workflowId, userId } });
      return NextResponse.json({ success: true, deleted: "all" });
    }

    return NextResponse.json({ error: "Provide id or workflowId" }, { status: 400 });
  } catch (err) {
    console.error("[run/delete]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}