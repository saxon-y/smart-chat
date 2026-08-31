import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership } from "@/lib/chat";
import { errorResponse, json } from "@/lib/http";
export async function POST(request: Request, context: { params: Promise<{ roomId: string; memberId: string }> }) {
 const user=await getCurrentUser(); if(!user)return errorResponse("需要先登录",401,"UNAUTHENTICATED"); const {roomId,memberId}=await context.params;
 const actor=await activeMembership(roomId,user.id); if(!actor||!["OWNER","MODERATOR"].includes(actor.roomRole))return errorResponse("无权限",403,"FORBIDDEN");
 const target=await db.roomMember.findFirst({where:{id:memberId,roomId,leftAt:null}}); if(!target||target.principalType!=="USER")return errorResponse("成员不存在",404,"NOT_FOUND"); if(target.roomRole==="OWNER"||(target.roomRole==="MODERATOR"&&actor.roomRole!=="OWNER"))return errorResponse("不能操作该成员",403,"FORBIDDEN");
 const body=await request.json().catch(()=>({})); if(body.action==="remove") { await db.roomMember.update({where:{id:memberId},data:{leftAt:new Date(),version:{increment:1}}}); return json({ok:true}); }
 if(body.action==="mute") { const minutes=Number(body.minutes); const until=minutes>0?new Date(Date.now()+minutes*60000):new Date("2999-01-01"); await db.roomMember.update({where:{id:memberId},data:{mutedUntil:until}}); return json({ok:true,mutedUntil:until}); }
 if(body.action==="unmute") { await db.roomMember.update({where:{id:memberId},data:{mutedUntil:null}}); return json({ok:true}); }
 return errorResponse("无效操作",400,"BAD_REQUEST");
}
