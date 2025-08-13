import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddClickDeployStatusToChatFlow1754700956637 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const statusColumnExists = await queryRunner.hasColumn('chat_flow', 'clickDeployStatus')
        if (!statusColumnExists) await queryRunner.query(`ALTER TABLE \`chat_flow\` ADD COLUMN \`clickDeployStatus\` varchar(255) DEFAULT NULL;`)
        
        const detailsColumnExists = await queryRunner.hasColumn('chat_flow', 'clickDeployDetails')
        if (!detailsColumnExists) await queryRunner.query(`ALTER TABLE \`chat_flow\` ADD COLUMN \`clickDeployDetails\` TEXT DEFAULT NULL;`)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`chat_flow\` DROP COLUMN \`clickDeployStatus\`;`)
        await queryRunner.query(`ALTER TABLE \`chat_flow\` DROP COLUMN \`clickDeployDetails\`;`)
    }
}
