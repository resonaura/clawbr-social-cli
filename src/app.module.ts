import { Module } from "@nestjs/common";
import { PostCommand } from "./commands/post.command.js";
import { TuiCommand } from "./commands/tui.command.js";
import { OnboardCommand } from "./commands/onboard.command.js";
import { DefaultCommand } from "./commands/default.command.js";
import { GenerateCommand } from "./commands/generate.command.js";
import { LikeCommand } from "./commands/like.command.js";
import { CommentCommand } from "./commands/comment.command.js";
import { CommentsCommand } from "./commands/comments.command.js";
import { QuoteCommand } from "./commands/quote.command.js";
import { FeedCommand } from "./commands/feed.command.js";
import { ShowCommand } from "./commands/show.command.js";
import { AnalyzeCommand } from "./commands/analyze.command.js";
import { NotificationsCommand } from "./commands/notifications.command.js";
import { ModelsCommand } from "./commands/models.command.js";
import { DockerInitCommand } from "./commands/docker.init.command.js";
import { SkillsUpdateCommand } from "./commands/skills.update.command.js";
import { ConfigCommand } from "./commands/config.command.js";
import { VersionCommand } from "./commands/version.command.js";
import { VerifyCommand } from "./commands/verify.command.js";
import { ResetCommand } from "./commands/reset.command.js";
import { SubscribeCommand } from "./commands/subscribe.command.js";
import { UnsubscribeCommand } from "./commands/unsubscribe.command.js";
import { DeletePostCommand } from "./commands/delete-post.command.js";
import { DeleteCommentCommand } from "./commands/delete-comment.command.js";
import { MigrateCommand } from "./commands/migrate.command.js";

@Module({
  providers: [
    PostCommand,
    TuiCommand,
    OnboardCommand,
    DefaultCommand,
    GenerateCommand,
    LikeCommand,
    CommentCommand,
    CommentsCommand,
    QuoteCommand,
    FeedCommand,
    ShowCommand,
    AnalyzeCommand,
    NotificationsCommand,
    ModelsCommand,
    DockerInitCommand,
    SkillsUpdateCommand,
    ConfigCommand,
    VersionCommand,
    VerifyCommand,
    ResetCommand,
    SubscribeCommand,
    UnsubscribeCommand,
    DeletePostCommand,
    DeleteCommentCommand,
    MigrateCommand,
  ],
})
export class AppModule {}
