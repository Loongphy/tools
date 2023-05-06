const { Octokit } = require("@octokit/core");
require('dotenv').config();

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

async function getAllStarredRepos() {
    try {
        let page = 0
        const set = new Set()
        // get all starred repos
        while (true) {
            const last_set = structuredClone(set)
            page++
            const { data } = await octokit.request(`GET /user/starred?per_page=100&page=${page}`, {
                headers: {
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            })
            data.forEach(item => set.add(item.full_name))

            if (set.size === last_set.size)  // no more repos
                break
        }
        return set
    } catch (error) {
        console.error(error);
    }
}

async function unstarRepo(full_name) {
    try {
        console.log(full_name)
        await octokit.request(`DELETE /user/starred/${full_name}`, {
            owner: 'OWNER',
            repo: 'REPO',
            headers: {
                'X-GitHub-Api-Version': '2022-11-28'
            }
        })
    } catch (error) {
        console.error(error);
    }
}

async function main() {
    console.log('Start getting starred repos……')
    const s = await getAllStarredRepos()
    console.log('End getting starred repos.')
    if (s.size === 0) {
        console.log("No starred repos!🎉")
        return;
    }

    console.log('Start unstar repos……')
    console.log("The following starred repos will be deleted:")
    s.forEach(item => unstarRepo(item))
    console.log('Done!🎉')
}

main()
