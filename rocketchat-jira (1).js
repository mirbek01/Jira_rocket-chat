/*

Alexandre Zia

Credits:
       This script adds functionality to the original code
       Original code from: Jonathan Gotti (malko) : https://github.com/malko/rocketchat-jira-hook/blob/master/jira-rocketchat-hook.js
*/
/*jshint  esnext:true*/

/* -----------------------------------------------------------------------------
    USAGE:

       Create a webhook in Jira: "System" -> "WebHooks" -> "+ Create a WebHook"
       - Copy RocketChat webhook URL into your new Jira webhook
       - Create a filter in "Events" or leave blank for all Issues ex. Project = My-Project
       - Select issue type you want to receive notifications from Jira:
           - Issue
                - created: Jira will notify about New issues
                - updated: Jira will notify about changes in existing issues
                - deleted: Jira will notify about deleted issues
           - Worklog
                updated: Jira will notify about work events

*/

// -----------------------------------------------------------------------------
// Configuration section, change the options bellow according to your needs

// notify on "updated" events only if an issue has become "Blocker"
// Usefull if you don't want to overflow your RocketChat channel with every issue
// change, but keep an eye when an issue escalates
// (In Jira webhook configuration, select to receive Issue 'updated' events)
//   false => notify for all changes
//   true => notify only if issue has become blocker
const NOTIFY_UPDATES_BLOCKER_ONLY = true;

// this setting depends of NOTIFY_UPDATES_BLOCKER_ONLY == false, otherwise it has no effect
// true => Show issue description on all messages
// false => show issue description only when it changes
const SHOW_DESCRIPTION = true;

// show the received webhook request content in RocketChat channel
const DEBUG_ON_CHANNEL = false;

// show the received webhook request content in RocketChat Log ("Administration" -> "View Log")
const DEBUG_ON_LOG = false;

// number of chars that message will be truncated to
const DESC_MAX_LENGTH = 140;

// -----------------------------------------------------------------------------
// DO NOT Change things below this line,(unless you know what you're doing)

function stripDesc(str)
{
    return str.length > DESC_MAX_LENGTH ? str.slice(0, DESC_MAX_LENGTH - 3) + '...' : str;
}

String.prototype.capitalizeFirstLetter = function()
{
    return this.charAt(0).toUpperCase() + this.slice(1);
}

class Script
{
    process_incoming_request({request})
    {
        const data = request.content;
        try
        {
            if (!data.issue)
            {
                return;
            }

            let issue = data.issue;
            let baseJiraUrl = issue.self.replace(/\/rest\/.*$/, '');
            let user = data.user;
            let user_name = user.displayName;
            let avatar_url = user.avatarUrls["48x48"];
            let user_login = user.name;
            let ref_url = issue.self;
            let url_parts = /^(\w+\:\/\/)?([^\/]+)(.*)$/.exec(ref_url);
            let url_origin = url_parts[1] + url_parts[2];
            let issue_icon = issue.fields.issuetype.iconUrl;
            let issue_type = issue.fields.issuetype.name;
            let issue_number = issue.key;
            let issue_title = issue.fields.summary;
            let issue_url = url_origin + '/browse/' + issue_number;
            let issue_link = '[' + issue_number + '](' + issue_url + ')';
            let priority = issue.fields.priority.name.replace(/^\s*\d*\.\s*/, '');
            let text = user_name;
            let text_base =  issue_type + ' ' + issue_link;
            let became_blocker = false;

            let message = {
                icon_url: avatar_url
                , alias: user_login
                , attachments: []
            };

            const attachment = {
                author_icon: issue_icon,
                author_name: issue_title,
                author_link: issue_url,
                fields: []
            };

            let insert_existing_priority = true;
            let insert_existing_description = true;
            let insert_existing_reporter = true;
            let insert_existing_assignee = true;
            if (data.changelog && data.changelog.items)
            {
                data.changelog.items.forEach((change) => {
                    if (change.field === 'reporter')
                    {
                        insert_existing_reporter = false;
                    }
                    if (change.field === 'assignee')
                    {
                        insert_existing_assignee = false;
                    }
                    if (change.field === 'priority')
                    {
                        insert_existing_priority = false;
                    }
                    if (change.field === 'description')
                    {
                        insert_existing_description = false;
                    }
                });
            }

            if(insert_existing_reporter === true)
            {
                if (issue.fields.reporter)
                {
                    attachment.fields.push({
                        title: 'Reporter',
                        value: issue.fields.reporter.displayName,
                        short: true
                    });
                }
            }

            if(insert_existing_assignee === true)
            {
                if (issue.fields.assignee)
                {
                    attachment.fields.push({
                        title: 'Assignee',
                        value: issue.fields.assignee.displayName,
                        short: true
                    });
                }
            }

            if (issue.fields.priority)
            {
                if(issue.fields.priority.name === 'Blocker')
                {
                    attachment.color = '#FF0000';
                }

                if(insert_existing_priority === true)
                {
                    attachment.fields.push({
                        title: 'Priority',
                        value: priority,
                        short: true
                    });
                }
            }

            if (data.webhookEvent === 'jira:issue_created')
            {
                emoji = ':new: ';
                text += ' created ' + text_base;
                message.text = emoji + text;
            }
            else if (data.webhookEvent === 'jira:issue_deleted')
            {
                emoji = ':heavy_multiplication_x: ';
                text += ' deleted ' + text_base;
                message.text = emoji + text;
            }
            else if (data.webhookEvent === 'jira:issue_updated')
            {
                // changed items
                if (data.changelog && data.changelog.items)
                {
                    emoji = '';
                    text += ' changed ' + text_base;
                    const actions = {
                        'jira:resolution': function(item, items)
                        {
                            emoji = item.to === null ? ':triangular_flag_on_post: ' : ':white_check_mark: ';
                            item = items['jira:status'];
                            return ' from "' + item.fromString + '" to "' + item.toString + '"';
                        }
                    }
                    let items = data.changelog.items;
                    let actions_items = {};
                    for (let i = 0; i < items.length; ++i)
                    {
                        let item = items[i];
                        let action = item.fieldtype + ':' + item.field;
                        actions_items[action] = item;
                    }
                    let result;
                    for (let action in actions_items)
                    {
                        let item = actions_items[action];
                        if (actions[action])
                        {
                            result = actions[action](item, actions_items);
                            text += result;
                            break;
                        }
                    }

                    let logs = [];
                    data.changelog.items.forEach((change) => {

                        emoji = emoji === '' ? ':arrows_counterclockwise: ' : ':white_check_mark: ';

                        // changed field: description
                        if (change.field === 'description' && NOTIFY_UPDATES_BLOCKER_ONLY === false)
                        {
                            attachment.fields.push({
                                title: 'Changed: description',
                                value: stripDesc(change.toString),
                                short: true
                            });
                        }
                        // changed other fields
                        else
                        {
                            if (change.to !== null)
                            {
                                if(NOTIFY_UPDATES_BLOCKER_ONLY === true && change.field === 'priority' && change.toString === 'Blocker')
                                {
                                    became_blocker = true;
                                }

                                attachment.fields.push({
                                    title: `Changed: ${change.field.capitalizeFirstLetter()}`,
                                    value: change.toString,
                                    short: true
                                });
                            }
                        }
                    });

                    message.text = emoji + text;
                }

                if(SHOW_DESCRIPTION === true && insert_existing_description === true)
                {
                    if (issue.fields.description)
                    {
                        attachment.fields.push({
                            title: 'Description',
                            value: stripDesc(issue.fields.description),
                            short: true
                        });
                    }
                }

                // added comment
                if (data.comment)
                {
                    let comment = data.comment;
                    let action = comment.created !== comment.updated ? 'Updated comment' : 'Commented';

                    emoji = ':speech_balloon: ';
                    text += ' ' + action + ' ' + issue_type + ' ' + issue_link;
                    message.text = emoji + text;

                    attachment.fields.push({
                        title: action,
                        value: stripDesc(comment.body),
                        short: true
                    });
                }
            }

            if( DEBUG_ON_CHANNEL === true)
            {
                attachment.fields.push({
                    title: 'Request',
                    value: JSON.stringify(request.content),
                    short: false
                });
            }

            if( DEBUG_ON_LOG === true)
            {
                console.log(JSON.stringify(request.content));
            }

            message.attachments = [attachment]

            if (message.text || message.attachments.length)
            {
                if(
                    (data.webhookEvent === 'jira:issue_created' || data.webhookEvent === 'jira:issue_deleted')
               ||   (data.webhookEvent === 'jira:issue_updated' && NOTIFY_UPDATES_BLOCKER_ONLY === false)
               ||   (data.webhookEvent === 'jira:issue_updated' && NOTIFY_UPDATES_BLOCKER_ONLY === true && became_blocker === true)
                )
                {
                    return {content: message};
                }
            }
        }
        catch(e)
        {
            console.log('jiraevent error', e);
            return {
                error: {
                    success: false,
                    message: `${e.message || e} ${JSON.stringify(data)}`
                }
            };
        }
    }
}
