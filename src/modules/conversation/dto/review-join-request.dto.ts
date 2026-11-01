import { IsIn } from "class-validator";

export class ReviewJoinRequestDto {

    @IsIn(['APPROVE', 'REJECT'])
    action: 'APPROVE' | 'REJECT';
}