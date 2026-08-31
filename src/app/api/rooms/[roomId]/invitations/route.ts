import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership, joinRoom } from "@/lib/chat";
import { errorResponse, json } from "@/lib/http";
export async function POST(request: Request, context: { params: Promise<{ roomId: string }> }) {
 const user=await getCurrentUser(); if(!user)return errorResponse("需要先登录",401,"UNAUTHENTICATED"); const roomId=(await context.params).roomId;
 const actor=await activeMembership(roomId,user.id); if(!actor||!["OWNER","MODERATOR"].includes(actor.roomRole))return errorResponse("无权限",403,"FORBIDDEN");
 const body=await request.json().catch(()=>({})); const userId=body.userId; if(typeof userId!=="string")return errorResponse("userId 必填",400,"BAD_REQUEST");
 const invite=await db.roomInvitation.create({data:{roomId,inviterId:user.id,inviteeId:userId}}); return json({invitation:invite},{status:201});
}
export async function GET(_r:Request, context:{params:Promise<{roomId:string}>}) { const user=await getCurrentUser(); if(!user)return errorResponse("需要先登录",401,"UNAUTHENTICATED"); const roomId=(await context.params).roomId; const invitations=await db.roomInvitation.findMany({where:{roomId,inviteeId:user.id,status:"PENDING"}}); return json({invitations}); }
