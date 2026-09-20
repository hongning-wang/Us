export type Participant = { id: string; username: string; name: string; photoUrl?: string; photoConfirmed?: boolean };
export type Pair = { conversationId: string; sender: Participant; recipient: Participant };
export type Message = { id: string; authorId: string; text: string; timestamp?: string; mediaUrl?: string; mediaKind?: 'reel' | 'video' | 'image'; kind?: 'real' | 'imagined'; order: number };
export type Reference = { kind: 'reel' | 'video'; mediaId: string; url?: string; messageId?: string; parentJobId?: string };
export type Job = { id: string; conversationId: string; sender: Participant; recipient: Participant; instruction: string; reference?: Reference; storyId: string; parentId?: string; sceneSummary?: string; status: 'generating' | 'ready' | 'sending' | 'sent' | 'failed'; phase?: string; outputUrl?: string; error?: string; fallbackUrl?: string; isFallback?: boolean; createdAt: string; deliveryMessageId?: string };
export type Setup = { pair?: Pair; importedCount: number; importComplete: boolean; memoryStatus: string; photoUrl?: string; photoConfirmed: boolean; recipientPhotoUrl?: string; recipientPhotoConfirmed?: boolean };
export type CreateJob = Pair & { instruction: string; reference?: Reference; idempotencyKey: string };
export interface UsBridge {
 getSetup(): Promise<Setup>;
 configure(pair: Pair): Promise<Setup>;
 confirmPhoto(file: File, participantId?: string): Promise<Setup>;
 photoCandidates?(participantId:string): Promise<PhotoCandidate[]>;
 candidateFile?(candidate:PhotoCandidate):Promise<File>;
 savedPhotoFile?(url:string):Promise<Blob>;
 importHistory(): Promise<Setup>;
 resetHistory(): Promise<Setup>;
 listJobs(): Promise<Job[]>;
 createJob(input: CreateJob): Promise<Job>;
 retryJob(id: string): Promise<Job>;
 sendJob(job: Job): Promise<Job>;
 useFallback(id: string): Promise<Job>;
}

export type PhotoCandidate={url:string;source:'profile'|'post';label:string};
