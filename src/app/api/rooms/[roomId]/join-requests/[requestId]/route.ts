import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership } from "@/lib/chat";
import { errorResponse, json } from "@/lib/http";
export async function POST(request: Request, context: { params: Promise<{ roomId: string; requestId: string }> }) {
 const user=await getCurrentUser(); if(!user)return errorResponse("需要先登录",401,"UNAUTHENTICATED"); const {roomId,requestId}=await context.params;
 const m=await activeMembership(roomId,user.id); if(!m||!["OWNER","MODERATOR"].includes(m.roomRole))return errorResponse("无权限",403,"FORBIDDEN");
 const body=await request.json().catch(()=>({})); const action=body.action;
 const req=await db.roomJoinRequest.findFirst({where:{id:requestId,roomId}}); if(!req)return errorResponse("申请不存在",404,"NOT_FOUND"); if(req.status!=="PENDING")return errorResponse("申请已处理",409,"CONFLICT");
 if(action==="approve") { const result=await db.$transaction(async tx=>{ const member=await tx.roomMember.create({data:{roomId,userId:req.userId,principalType:"USER"}}); const updated=await tx.roomJoinRequest.update({where:{id:req.id},data:{status:"APPROVED",reviewedById:user.id,reviewedAt:new Date()}}); return {member,request:updated}; }); return json(result); }
 if(action==="reject") { const updated=await db.roomJoinRequest.update({where:{id:req.id},data:{status:"REJECTED",reviewedById:user.id,reviewedAt:new Date(),reviewReason:typeof body.reason==="string"?body.reason.slice(0,500):undefined}}); return json({request:updated}); }
 return errorResponse("无效操作",400,"BAD_REQUEST");
}
