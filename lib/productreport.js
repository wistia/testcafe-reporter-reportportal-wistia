require('dotenv').config();
const fs = require('fs');
const stripAnsi = require('strip-ansi');
const RPClient = require('reportportal-js-client');

const baseUrl = process.env.REPORT_PORTAL_BASE_URL + '/api/v1';

export default class ProductReport {

    constructor() {
        this.projectName = process.env.REPORT_PORTAL_PROJECT_NAME;
        this.launchName = process.env.REPORT_PORTAL_LAUNCH_NAME || this.projectName;
        this.description = typeof process.env.REPORT_PORTAL_DESCRIPTION === 'undefined' ? void 0 : process.env.REPORT_PORTAL_DESCRIPTION;
        this.tagsList = typeof process.env.REPORT_PORTAL_TAGS === 'undefined' ? void 0 : process.env.REPORT_PORTAL_TAGS.split(',');
        this.fixtureList = [];
        this.connected = true;

        this.rpClient = new RPClient({
            token : process.env.REPORT_PORTAL_TOKEN,
            endpoint : baseUrl,
            launch : this.launchName,
            project : this.projectName
        });

        this.rpClient.checkConnect().then((response) => {
            this.connected = true;
            // console.log('You have successfully connected to the server.');
            // console.log(`You are using an account: ${response.full_name}`);
        }, (error) => {
            console.warn('Error connecting to ReportPortal, confirm that your details are correct.');
            console.dir(error);
            this.connected = false;
        });
    }

    startLaunch() {
        if (!this.connected) return 'Unknown Launch ID';
        let launchId;

        if (process.env.REPORT_PORTAL_LAUNCH_ID) {
            // fake out the internal data structure like we made a call to start the test. yuck.
            this.rpClient.map[process.env.REPORT_PORTAL_LAUNCH_ID] = this.rpClient.getNewItemObj((resolve) => resolve({}));
            this.rpClient.map[process.env.REPORT_PORTAL_LAUNCH_ID].realId = process.env.REPORT_PORTAL_LAUNCH_ID;

            launchId = process.env.REPORT_PORTAL_LAUNCH_ID;
        } else {
            const launchObj = this.rpClient.startLaunch({
                name: this.launchName,
                description: this.description,
                tags: this.tagsList
            });

            launchId = launchObj.tempId;
        }

        return launchId;
    }

    captureFixtureItem(launchId, fixtureName) {
        if (!this.connected) return 'Unknown Test ID';
        const suiteObj = this.rpClient.startTestItem({
            name: fixtureName,
            type: 'SUITE'
        }, launchId);

        this.fixtureList.push(suiteObj.tempId);
        return suiteObj.tempId;
    }

    captureTestItem(launchId, fixtureId, stepName, status, testRunInfo, parentSelf) {
        if (!this.connected) return;

        var start_time = this.rpClient.helpers.now();
        const stepObj = this.rpClient.startTestItem({
            name: stepName,
            start_time: start_time,
            type: 'STEP'
        }, launchId, fixtureId);

        const debug_output = JSON.stringify(testRunInfo, null, 2);
        console.log(debug_output);

        if (testRunInfo.screenshots) {
            testRunInfo.screenshots.forEach((screenshot, idx) => {
                // console.log('screenshotPath -> ', screenshot.screenshotPath);

                const screenshotContent = fs.readFileSync(screenshot.screenshotPath);

                this.rpClient.sendLog(stepObj.tempId, 
                    {
                        status: 'error',
                        message: 'Error Screenshot',
                        time: start_time
                    },
                    {
                        name: `${stepName}.png`,
                        type: 'image/png',
                        content: screenshotContent
                    }
                );
            });
        }

        if (testRunInfo.errs) {
            testRunInfo.errs.forEach((err, idx) => {
                err = parentSelf.formatError(err);

                this.rpClient.sendLog(stepObj.tempId, {
                    status: 'error',
                    message: stripAnsi(err),
                    time: start_time
                });
            });
        }

        var testResult = {
            status: status,
            end_time: start_time + testRunInfo.durationMs
        };

        if (status === 'skipped') testResult.issue = { issue_type: 'NOT_ISSUE' };

        this.rpClient.finishTestItem(stepObj.tempId, testResult);
    }

    async finishFixture() {
        if (!this.connected) return;     
        this.fixtureList.forEach(async (fixtureId, idx) => {
            await this.rpClient.finishTestItem(fixtureId, {
                end_time: this.rpClient.helpers.now()
            });
        });
    }

    async finishLaunch(launchId) {
        if (!this.connected) return;
        await this.finishFixture();
        if (!process.env.REPORT_PORTAL_LAUNCH_ID) {
            await this.rpClient.finishLaunch(launchId, {
                end_time: this.rpClient.helpers.now()
            });
        }
    }

}
