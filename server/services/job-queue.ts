// In-memory job queue for async document processing
interface Job {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  fileName: string;
  progress: number; // 0-100
  currentPage?: number;
  totalPages?: number;
  result?: any;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

class JobQueue {
  private jobs: Map<string, Job> = new Map();
  private processingQueue: string[] = [];

  createJob(fileName: string): string {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const job: Job = {
      id: jobId,
      status: 'pending',
      fileName,
      progress: 0,
      createdAt: new Date(),
    };
    this.jobs.set(jobId, job);
    this.processingQueue.push(jobId);
    return jobId;
  }

  getJob(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  updateJob(jobId: string, updates: Partial<Job>) {
    const job = this.jobs.get(jobId);
    if (job) {
      Object.assign(job, updates);
      this.jobs.set(jobId, job);
    }
  }

  setJobProcessing(jobId: string, totalPages?: number) {
    this.updateJob(jobId, {
      status: 'processing',
      progress: 5,
      totalPages,
    });
  }

  updateProgress(jobId: string, currentPage: number, totalPages: number) {
    // Progress: 5% start, 5-95% processing, 95-100% saving
    const processingProgress = 5 + (currentPage / totalPages) * 90;
    this.updateJob(jobId, {
      currentPage,
      totalPages,
      progress: Math.round(processingProgress),
    });
  }

  setJobCompleted(jobId: string, result: any) {
    this.updateJob(jobId, {
      status: 'completed',
      progress: 100,
      result,
      completedAt: new Date(),
    });
    // Remove from processing queue
    this.processingQueue = this.processingQueue.filter(id => id !== jobId);
  }

  setJobFailed(jobId: string, error: string) {
    this.updateJob(jobId, {
      status: 'failed',
      progress: 0,
      error,
      completedAt: new Date(),
    });
    // Remove from processing queue
    this.processingQueue = this.processingQueue.filter(id => id !== jobId);
  }

  // Cleanup old jobs (older than 1 hour)
  cleanupOldJobs() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    for (const [jobId, job] of this.jobs.entries()) {
      if (job.completedAt && job.completedAt < oneHourAgo) {
        this.jobs.delete(jobId);
      }
    }
  }
}

// Singleton instance
export const jobQueue = new JobQueue();

// Cleanup every 10 minutes
setInterval(() => {
  jobQueue.cleanupOldJobs();
}, 10 * 60 * 1000);
